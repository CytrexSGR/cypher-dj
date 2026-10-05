"""Auswertung eines Laufordners (Scheibe 16): Stille, Naht-Sprünge, Raster in der Schleife und nach Rückkehr, Notbahn-
Zustände, Frame-Lücken von Kern, Quelle und Aufnehmer, je Eingriffsfenster und für den Rest des Laufs (Negativ-Kontrolle).
Liest nur den Laufordner (lauf.json, aufnahme.wav + .json, osc.jsonl, journal-*.txt), schreibt auswertung.json.

Kanäle am Ziel: Prüfquelle L Dauerton (Stille, Naht), R Klick (Raster); Kern L = R Prüfklick (Stille nur in
Klick-Auflösung: ein Schlag, 469 ms bei 128 BPM; Naht nicht messbar, weil der Prüfklick takt-periodisch ist).
"""
import json
import re
import warnings
from pathlib import Path

import numpy as np
from scipy.io import wavfile

import messer

SR = 48000
warnings.filterwarnings("ignore", category=wavfile.WavFileWarning)


def lies_jsonl(p):
    out = []
    if Path(p).exists():
        for z in open(p):
            try:
                out.append(json.loads(z))
            except json.JSONDecodeError:
                pass
    return out


def quelle_journal(txt):
    starts = len(re.findall(r"pruefquelle start ", txt))
    enden = re.findall(r"pruefquelle ende zyklen (\d+) spins (\d+) luecken (\d+) luecken_frames (\d+)", txt)
    return {"starts": starts, "enden": len(enden), "spins": sum(int(e[1]) for e in enden),
            "luecken": sum(int(e[2]) for e in enden), "zyklen": sum(int(e[0]) for e in enden),
            "spin_t_ns": [int(t) for t in re.findall(r"pruefquelle spin \d+ t_ns (\d+)", txt)]}


def folge(zust):
    """Zustandsfolge ohne Wiederholungen, z. B. [0, 1, 3, 0]."""
    out = []
    for z in zust:
        if not out or out[-1] != z:
            out.append(z)
    return out


def enthaelt(f, teil):
    """Ist `teil` eine Teilfolge (in dieser Reihenfolge, nicht unbedingt zusammenhängend) von `f`?"""
    it = iter(f)
    return all(any(x == t for x in it) for t in teil)


def notbahn_journal(txt):
    """Zustandswechsel der Notbahn aus ihrem Journal (short-monotonic, CLOCK_MONOTONIC in s): [(t_ns, zustand)].
    Genauer als /nb: die Notbahn meldet /nb aus einem 10-ms-Takt, eine Rückgabe (3) über 256 Samples (5,3 ms) fällt
    dort oft zwischen zwei Meldungen (gemessen 2026-09-26, sigstop-kern-ohne-kante: Journal 1, 3, 0; /nb 1, 0)."""
    out = []
    for m in re.finditer(r"^\[\s*(\d+\.\d+)\].*?: zustand (\d+) w \d+", txt, re.M):
        out.append((int(round(float(m.group(1)) * 1e9)), int(m.group(2))))
    return out


def nb_im_fenster(nb, t0, t1, journal=None):
    z = [m for m in nb if t0 <= m["t_ns"] <= t1]
    zust = [m["werte"][0] for m in z]
    j = [zz for t, zz in (journal or []) if t0 <= t <= t1]
    uebern = sum(1 for a, b in zip([0] + zust, zust) if b == 1 and a != 1)
    return {"meldungen": len(z), "zustaende": sorted(set(zust) | set(j)), "uebernahmen": uebern, "folge": folge(zust),
            "folge_journal": folge(j) if journal is not None else None,
            "takte_max": max((m["werte"][1] for m in z), default=0)}


def kern_telemetrie(zk, t0, t1):
    z = [m["werte"] for m in zk if t0 <= m["t_ns"] <= t1]
    if not z:
        return {"meldungen": 0}
    gen = z[-1][0]
    g = [w for w in z if w[0] == gen]
    return {"meldungen": len(z), "generationen": sorted({w[0] for w in z}), "quantum": z[-1][1],
            "frame_luecken": g[-1][3] - g[0][3], "ausgelassene_perioden": g[-1][4] - g[0][4],
            "cb_max_us": max(w[5] for w in z), "cb_p99_us_max": max(w[6] for w in z),
            "aufwach_max_us": max(w[7] for w in z)}


def fenster_messen(ton, klick, e, spb, a0, a, s_bis, b, rueck_ab, art, x=None, schleife=None, quantum=256):
    """Stille und Schleifen-Raster über [a0, s_bis) (solange die Quelle weg ist), Sprünge und Rückkehr-Raster über
    [a0, b) (samt Rückgabe), Schleifen-Treue über schleife = (von, bis) auf allen Kanälen `x`. Für den Rest des Laufs
    ist a0 = a = Anfang und s_bis = b = Ende, art None."""
    m = {"von": int(a0), "eingriff": int(a), "stille_bis": int(s_bis), "bis": int(b)}
    if x is not None and schleife is not None:
        m["schleife"] = messer.schleife_treue(x, 4 * spb, schleife[0], schleife[1])
    if ton is not None:
        st = messer.stille(ton[a0:s_bis])
        m["stille"] = {"ereignisse": len(st), "laengste_ms": max((l for _, l in st), default=0) * 1000.0 / SR,
                       "an_ms": [round((s + a0 - a) * 1000.0 / SR, 2) for s, _ in st][:10]}
        idx, werte, nat = messer.spruenge(ton[a0:b])
        m["spruenge"] = {"anzahl": int(idx.size), "max": float(werte.max()) if werte.size else 0.0,
                         "max_natuerlich": nat, "an_ms": [round((i + a0 - a) * 1000.0 / SR, 2) for i in idx[:10]]}
        kl = messer.bloecke(ton[a0 - a0 % 256:s_bis], 256)
        m["bloecke"] = {"stille": kl.count("stille"), "gleich": kl.count("gleich")}
    else:
        pausen = messer.klick_pausen(e, spb, a0, s_bis)
        m["stille"] = {"klick_aufloesung": True, "fehlende_klicks": pausen["fehlende_klicks"],
                       "laengste_ms": (pausen["stille_samples"] or 0.0) * 1000.0 / SR, "klicks": pausen["klicks"]}
        ausn = [(int(x) - a0, int(x) - a0 + 96) for x in e if a0 <= x < b]
        idx, werte, nat = messer.spruenge(klick[a0:b], ausnahmen=ausn)
        m["spruenge"] = {"anzahl": int(idx.size), "max": float(werte.max()) if werte.size else 0.0,
                         "max_natuerlich": nat, "naht_messbar": False}
        if art is None:                                   # Lücken am Ziel aus dem Klick-Raster (Kern, §5.4 gegenprüfen)
            m["ziel_luecken"] = messer.raster_luecken(e[(e >= a0) & (e < b)], spb, quantum)
    if art is not None:
        m["raster_schleife"] = messer.raster_versatz(e[e < s_bis], spb, vor_ende=a, nach_anfang=a)
        m["raster_rueckkehr"] = messer.raster_versatz(e[e < b], spb, vor_ende=a, nach_anfang=rueck_ab) if rueck_ab else None
    return m


def werte_aus(ordner):
    o = Path(ordner)
    L = json.loads((o / "lauf.json").read_text())
    p = L["profil"]
    A = {"name": p["name"], "fehler_im_lauf": L.get("fehler")}
    wav = o / "aufnahme.wav"
    if not wav.exists():
        A["ergebnis"] = "unbrauchbar"
        A["grund"] = "keine Aufnahme"
        return A
    sr, d = wavfile.read(wav)
    meta = json.loads((o / "aufnahme.wav.json").read_text())
    x = d.astype(np.float64)
    t_auf = meta["erster_mono_ns"]

    def frame(t_ns):
        return int(round((t_ns - t_auf) * SR / 1e9))

    spb = SR * 60.0 / p["bpm"]
    ist_kern = p["quelle"]["art"] == "kern"
    ton = None if ist_kern else x[:, 0]
    klick = x[:, 0] if ist_kern else x[:, 1]
    e = messer.einsaetze(klick)
    n = len(x)
    osc_log = lies_jsonl(o / "osc.jsonl")
    nb = [m for m in osc_log if m.get("adresse") == "/nb"]
    jn = o / "journal-notbahn.txt"
    nb_journal = notbahn_journal(jn.read_text()) if jn.exists() else None
    zk = [m for m in osc_log if m.get("adresse") == "/zustand/kern"]
    t_ende_auf = t_auf + int(n * 1e9 / SR)
    A["instrument"] = {"aufnehmer_luecken": meta["luecken"], "aufnehmer_ueberlauf": meta["ueberlauf"],
                       "frames": n, "quantum": meta["quantum"], "sr": int(sr), "klicks": int(e.size)}
    brauchbar = meta["luecken"] == 0 and meta["ueberlauf"] == 0 and sr == SR and meta["quantum"] == p["quantum"]
    fenster = []
    eg = L["eingriffe"]
    acht_takte = int(32 * spb)
    sieben_takte = int(28 * spb)                          # die Ausblende beginnt 7 bis 8 Takte nach der Übernahme
    for j, g in enumerate(eg):
        a = frame(g["t_ns"])
        naechst = frame(eg[j + 1]["t_ns"]) - int(0.5 * SR) if j + 1 < len(eg) else n
        if g["art"] == "sigstop":                          # Stille nur, solange der Prozess steht
            rueck = frame(g["t_cont_ns"]) + SR
            b = min(naechst, frame(g["t_cont_ns"]) + 2 * SR)
            s_bis = min(b, frame(g["t_cont_ns"]))
            schleife_bis = min(s_bis, a + sieben_takte)
        elif g.get("t_neu_ns"):                            # Neustart: Stille bis samt Rückgabe
            rueck = frame(g["t_neu_ns"]) + SR
            b = s_bis = min(naechst, frame(g["t_neu_ns"]) + 2 * SR)
            schleife_bis = min(frame(g["t_neu_ns"]), a + sieben_takte)
        else:                                              # Quelle bleibt tot: gemessen wird die Schleife (8 Takte)
            rueck = None
            b = s_bis = min(naechst, a + acht_takte)
            schleife_bis = min(naechst, a + sieben_takte)
        a0 = max(a - SR // 2, 0)
        # Der Prüfklick ist bei ganzzahligem Takt taktperiodisch: die Treue gilt dann schon vor der Übernahme und deckt
        # die Naht mit ab. Der Ton der Prüfquelle wechselt je Takt das Vorzeichen, und die Notbahn daneben spielt ab der
        # Übernahme den letzten VOLLENDETEN Takt (ADR 016): bis zur nächsten Takt-Eins gleicht das Ziel dem Takt davor
        # (der Quelle), danach zwei Takte davor. Frame gegen Frame einen Takt früher gilt darum erst, wenn auch der Takt
        # davor schon Schleife war: ab einem Takt plus 0,1 s nach dem Eingriff (die 0,1 s decken den Block Stille und die
        # Übernahme-Latenz). Stille und Naht dazwischen misst der Ton in voller Auflösung.
        von = a0 if ist_kern else a + int(4 * spb) + SR // 10
        m = fenster_messen(ton, klick, e, spb, a0, a, min(s_bis, n), min(b, n), rueck, g["art"], x=x,
                           schleife=(von, min(schleife_bis, n)), quantum=p["quantum"])
        m["art"], m["ziel"] = g["art"], g["ziel"]
        m["bis_ausschluss"] = min(naechst, n) if rueck is None else min(b, n)   # danach Ausblende und Stille (ADR 016)
        nach = e[e >= a]
        m["letzter_klick_nach_ms"] = round((int(nach[-1]) - a) * 1000.0 / SR, 1) if nach.size else None
        m["notbahn"] = nb_im_fenster(nb, g["t_ns"] - 500_000_000, t_auf + int(min(b, n) * 1e9 / SR), nb_journal)
        fenster.append(m)
    A["eingriffe"] = fenster
    # Negativ-Kontrolle: alles außerhalb der Eingriffsfenster (ohne die letzten 0,2 s)
    frei = np.ones(n, dtype=bool)
    frei[max(n - SR // 5, 0):] = False
    for m in fenster:
        frei[m["von"]:m["bis_ausschluss"]] = False
    a_s, l_s = messer.laeufe(frei)
    teile = [fenster_messen(ton, klick, e, spb, int(s), int(s), int(s + ln), int(s + ln), None, None,
                            quantum=p["quantum"]) for s, ln in zip(a_s, l_s) if ln > 2 * SR]
    ruhe = {"teile": len(teile), "sekunden": round(float(frei.sum()) / SR, 1),
            "stille_ereignisse": sum(t["stille"].get("ereignisse", t["stille"].get("fehlende_klicks") or 0) for t in teile),
            "stille_laengste_ms": max((t["stille"]["laengste_ms"] for t in teile), default=0.0),
            "spruenge": sum(t["spruenge"]["anzahl"] for t in teile),
            "spruenge_max_natuerlich": max((t["spruenge"]["max_natuerlich"] for t in teile), default=0.0)}
    if ist_kern:
        ruhe["fehlende_klicks"] = sum(t["stille"]["fehlende_klicks"] or 0 for t in teile)
        ruhe["ziel_luecken"] = sum(t["ziel_luecken"]["luecken"] for t in teile)
        ruhe["ziel_luecken_rueckwaerts"] = sum(t["ziel_luecken"]["rueckwaerts"] for t in teile)
        ruhe["ziel_luecken_krumm"] = sum(t["ziel_luecken"]["krumm"] for t in teile)
        ruhe["ziel_luecken_spruenge"] = [s for t in teile for s in t["ziel_luecken"]["spruenge"]][:50]
    ef = e[frei[e]] if e.size else e
    ruhe["raster_streuung"] = float(np.ptp(messer.phasen(ef, spb))) if ef.size > 1 else None
    ruhe["notbahn_uebernahmen"] = sum(nb_im_fenster(nb, t_auf + int(s * 1e9 / SR), t_auf + int((s + ln) * 1e9 / SR))
                                      ["uebernahmen"] for s, ln in zip(a_s, l_s))
    A["ruhe"] = ruhe
    ganz_stille = messer.stille(ton) if ton is not None else []
    A["gesamt"] = {"stille_ereignisse": len(ganz_stille), "spruenge": int(messer.spruenge(ton)[0].size) if ton is not None
                   else None, "notbahn": nb_im_fenster(nb, t_auf, t_ende_auf)}
    if ton is not None:                                   # Stille oder alter Block? (10 Probe e: ein Ausfall ist Stille)
        kl = messer.bloecke(ton, p["quantum"])
        A["gesamt"]["bloecke"] = {"stille": kl.count("stille"), "gleich": kl.count("gleich"), "neu": kl.count("neu")}
    A["kern"] = kern_telemetrie(zk, t_auf, t_ende_auf) if ist_kern else None
    A["quelle"] = quelle_journal((o / "journal-quelle.txt").read_text()) if not ist_kern and (o / "journal-quelle.txt").exists() else None
    if A["quelle"] is not None:                           # Spins im Aufnahmefenster (die Quelle läuft vorher und nachher)
        A["quelle"]["spins_im_fenster"] = sum(1 for t in A["quelle"].pop("spin_t_ns") if t_auf <= t < t_ende_auf)
    diff = sorted(set(L["module_vorher"]) ^ set(L["module_nachher"]))
    eigen = re.compile(rf"sink_name={re.escape(L['senke'])}(\s|$)")
    A["senke"] = {"module_gleich": L["module_vorher"] == L["module_nachher"],
                  "eigene_aenderungen": [z for z in diff if eigen.search(z)],
                  "fremde_aenderungen": [z for z in diff if not eigen.search(z)],
                  "units_reste": L.get("units_reste", "")}
    A["fremdlast"] = {"vorher": L["fremdlast_vorher"]["last1"], "nachher": L["fremdlast_nachher"]["last1"],
                      "gpu_vorher": L["fremdlast_vorher"]["gpu"], "gpu_nachher": L["fremdlast_nachher"]["gpu"]}
    # Fremdlast über 4 heißt vorläufig (E7). Mit P1 ist die Last nachher die eigene (gemessen 2026-09-26: 35,8 nach
    # p1-kern bei 1,95 vorher): dann zählt nur die Last vorher.
    eigene_last = p["last"]["profil"] == "p1"
    A["vorlaeufig"] = (A["fremdlast"]["vorher"] if eigene_last else max(A["fremdlast"]["vorher"],
                                                                          A["fremdlast"]["nachher"])) > 4.0
    A["last"] = L.get("last")
    A["urteile"] = urteile(A, p["erwartung"]) + [{
        "schluessel": "senke_entladen", "grenze": "keine eigene Änderung in pactl list short modules, keine Unit übrig",
        "wert": len(A["senke"]["eigene_aenderungen"]) + (1 if A["senke"]["units_reste"] else 0),
        "ok": not A["senke"]["eigene_aenderungen"] and not A["senke"]["units_reste"]}]
    gruende = []
    if not brauchbar:
        gruende.append(f"Aufnehmer {meta['luecken']} Lücken, {meta['ueberlauf']} Überläufe, {sr} Hz, "
                       f"Quantum {meta['quantum']} (verlangt 0, 0, {SR}, {p['quantum']})")
    if L.get("fehler"):
        gruende.append(f"Lauf: {L['fehler']}")
    if gruende:
        A["ergebnis"], A["grund"] = "unbrauchbar", "; ".join(gruende)
    else:
        A["ergebnis"] = "erfuellt" if all(u["ok"] for u in A["urteile"]) else "verfehlt"
    (o / "auswertung.json").write_text(json.dumps(A, indent=1, ensure_ascii=False, default=float) + "\n")
    return A


def last_belegt(la):
    """P1 hat wirklich gelastet: beide Lastprozesse mindestens einen Kern im Mittel, demucs mindestens eine Runde, lastgen
    mit Durchsatz. Ein P1, das nicht startet (falsches Python, fehlendes Programm), fällt hier auf."""
    if not la:
        return False
    return bool((la.get("lastgen_kerne") or 0) >= 1.0 and (la.get("demucs_kerne") or 0) >= 1.0
                and (la.get("demucs_runden") or 0) >= 1 and (la.get("lastgen_durchsatz_gib_s") or 0) > 0)


def urteile(A, erw):
    """Je Schlüssel aus [erwartung] ein Urteil {schluessel, grenze, wert, ok}."""
    f = A["eingriffe"]
    stille_ms = max([m["stille"]["laengste_ms"] for m in f] + [A["ruhe"]["stille_laengste_ms"]])
    rueck = [abs(m["raster_rueckkehr"]["versatz_samples"]) for m in f if m.get("raster_rueckkehr")]
    fehlend = sum(m["stille"].get("fehlende_klicks") or 0 for m in f) + A["ruhe"].get("fehlende_klicks", 0)
    spins = (A.get("quelle") or {}).get("spins_im_fenster")
    zl = A["ruhe"].get("ziel_luecken")
    kl = (A.get("kern") or {}).get("ausgelassene_perioden")
    werte = {
        "stille_ms_max": stille_ms,
        "stille_ereignisse_min": A["gesamt"]["stille_ereignisse"],
        "stille_ereignisse_max": A["gesamt"]["stille_ereignisse"],
        "spruenge_je_eingriff_min": min((m["spruenge"]["anzahl"] for m in f), default=None),
        "eingriffe_mit_sprung_min": sum(1 for m in f if m["spruenge"]["anzahl"] > 0),
        "spruenge_max": sum(m["spruenge"]["anzahl"] for m in f) + A["ruhe"]["spruenge"],
        "raster_versatz_max": max(rueck + [A["ruhe"]["raster_streuung"] or 0.0]),
        "fehlende_klicks_max": fehlend,
        "fehlende_klicks_min": fehlend,
        "kern_luecken_min": (A["kern"] or {}).get("frame_luecken"),
        "kern_luecken_max": (A["kern"] or {}).get("frame_luecken"),
        "notbahn_uebernahmen_min": A["gesamt"]["notbahn"]["uebernahmen"],
        "notbahn_uebernahmen_max": A["gesamt"]["notbahn"]["uebernahmen"],
        "schleife_in_jedem_eingriff": bool(f) and all(1 in m["notbahn"]["zustaende"] for m in f),
        "last_belegt": last_belegt(A.get("last")),
        "schleife_abweichung_max": max((m["schleife"]["abweichend"] + m["schleife"]["stille_frames"] for m in f
                                        if m.get("schleife")), default=None),
        "stille_bloecke_max": max((m["bloecke"]["stille"] for m in f if m.get("bloecke")), default=None) if f else None,
        "spins_min": spins,
        "spin_luecken_abweichung_max": abs(A["gesamt"]["stille_ereignisse"] - spins) if spins is not None else None,
        "ziel_luecken_min": zl,
        "ziel_luecken_max": zl,
        "kern_ziel_luecken_abweichung_max": abs(kl - zl) if kl is not None and zl is not None else None,
        "raster_schleife_max": max((abs(m["raster_schleife"]["versatz_samples"]) for m in f if m.get("raster_schleife")),
                                   default=None),
        "rueckgabe_in_jedem_eingriff": bool(f) and all(enthaelt(m["notbahn"].get("folge_journal") or m["notbahn"]["folge"],
                                                                [1, 3, 0]) for m in f),
    }
    out = []
    for k, grenze in erw.items():
        w = werte[k]
        if w is None:
            ok = False
        elif k.endswith("_min"):
            ok = w >= grenze
        elif k.endswith("_max"):
            ok = w <= grenze
        else:
            ok = w == grenze
        out.append({"schluessel": k, "grenze": grenze, "wert": w, "ok": bool(ok)})
    return out
