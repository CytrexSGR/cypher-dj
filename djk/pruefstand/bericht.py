"""Bericht eines Prüflaufs (Scheibe 16): bericht.md aus lauf.json und auswertung.json, mit Urteil je Erwartung und je
Zusage aus ARCHITEKTUR §7, soweit dieser Lauf sie misst. Was er nicht misst, steht als „nicht in diesem Lauf“ da."""
import json
from pathlib import Path


def _z(v, nachkomma=1):
    if v is None:
        return "–"
    if isinstance(v, float):
        return f"{v:.{nachkomma}f}".replace(".", ",")
    return str(v)


def _schleife(sl):
    return "–" if not sl else f"{sl['frames']}, {sl['abweichend']}, {sl['stille_frames']}"


def zusagen(L, A):
    """Zeilen (Zusage, Grenze, gemessen, Urteil) für ARCHITEKTUR §7."""
    p = L["profil"]
    f = A.get("eingriffe", [])
    q = p["quelle"]["art"]
    kills = [m for m in f if m["art"] == "kill9" and m["ziel"] == "quelle"]
    stops = [m for m in f if m["art"] == "sigstop" and m["ziel"] == "quelle"]
    per_us = 1e6 * p["quantum"] / 48000.0
    zeilen = []
    aufl = (" (Prüfklick: kein Klick fehlt und die Schleife gleicht dem Takt davor Sample für Sample; Stille ist nur "
            "sichtbar, wo der Takt davor Signal hatte)") if q == "kern" else ""

    def still(m):
        sl = m.get("schleife") or {}
        return bool(m["stille"]["laengste_ms"] or m["stille"].get("fehlende_klicks") or sl.get("stille_frames")
                    or sl.get("abweichend"))
    grenze_tot = ("höchstens 1 Block Stille (Knack) je Absturz in 20 von 20, Notbahn daneben (ADR 016 Nachtrag "
                  "2026-09-25); alte Grenze, Notbahn in Reihe: 0 ms in 20 von 20")
    if kills and q == "pruefquelle":
        bl = [m.get("bloecke", {}).get("stille") for m in kills]
        n1 = sum(1 for b in bl if b is not None and b <= 1)
        zeilen.append(("Kern stirbt: Stille", grenze_tot,
                       f"höchstens 1 Block in {n1} von {len(kills)} (stille Blöcke je Eingriff {bl}, längste Stille "
                       f"{', '.join(_z(m['stille']['laengste_ms'], 2) for m in kills)} ms)",
                       ("Teil erfüllt" if len(kills) < 20 else "erfüllt") if n1 == len(kills) else "verfehlt"))
        ns = sum(1 for m in kills if m["spruenge"]["anzahl"] > 0)
        zeilen.append(("Kern stirbt: Naht", "daneben: Knack je Absturz zugelassen, Hörprobe Scheibe 46; alte Grenze "
                       "in Reihe: ohne Hochton-Sprung über 6 dB in 18 von 20",
                       f"Sprung über 0,01 in {ns} von {len(kills)} (Ersatzgröße, Hochton-Maß erst mit Musik)",
                       "nur berichtet"))
    elif kills and q == "kern":
        n0 = sum(1 for m in kills if not still(m))
        zeilen.append(("Kern stirbt: Stille", grenze_tot, f"keine Stille sichtbar in {n0} von {len(kills)}{aufl}",
                       ("Teil erfüllt" if len(kills) < 20 else "erfüllt") if n0 == len(kills) else "verfehlt"))
    if stops and q in ("kern", "pruefquelle"):
        n0 = sum(1 for m in stops if not still(m))
        zeilen.append(("Kern hängt: Stille", "0 ms in 10 von 10", f"0 ms in {n0} von {len(stops)}{aufl}",
                       "Teil erfüllt" if n0 == len(stops) else "verfehlt"))
        zeilen.append(("Kern hängt: Watchdog", "tötet nach höchstens 250 ms", "kein Watchdog vor Scheibe 18",
                       "nicht in diesem Lauf"))
    rueck = [m["raster_rueckkehr"] for m in f if m.get("raster_rueckkehr")]
    if rueck:
        mx = max(abs(r["versatz_samples"]) for r in rueck)
        zeilen.append(("Kern wieder hörbar: Raster", "höchstens 1 Sample", f"{_z(mx)} Samples (größter Betrag)",
                       "erfüllt" if mx <= 1 else "verfehlt"))
    k = A.get("kern") or {}
    if k.get("meldungen"):
        if p["last"]["profil"] == "p1":
            ok = k["aufwach_max_us"] < 0.3 * per_us and k["frame_luecken"] == 0
            zeilen.append(("Werkstatt rechnet im Set (P1)", "Aufwachen unter 30 % der Periode, 0 Lücken",
                           f"Aufwachen max {k['aufwach_max_us']} µs = {_z(100 * k['aufwach_max_us'] / per_us)} %, "
                           f"{k['frame_luecken']} Lücken", "erfüllt" if ok else "verfehlt"))
        zeilen.append(("Callback des Kerns", "p99,9 unter 20 %, Maximum unter 50 % der Periode",
                       f"Maximum {k['cb_max_us']} µs = {_z(100 * k['cb_max_us'] / per_us)} %, "
                       f"p99 je Sekunde höchstens {k['cb_p99_us_max']} µs (p99,9 meldet der Kern nicht)",
                       "Maximum erfüllt" if k["cb_max_us"] < 0.5 * per_us else "verfehlt"))
    nb_tot = [m for m in f if m["ziel"] == "notbahn" and m["art"] == "kill9"]
    if nb_tot:
        fk = sum(m["stille"].get("fehlende_klicks") or 0 for m in nb_tot)
        zeilen.append(("Notbahn stirbt (Tabelle oben: Stille bis Neustart, in Reihe)", "daneben: kein Einfluss aufs Ziel",
                       f"{fk} fehlende Klicks in 8 Takten nach dem Eingriff{aufl}", "erfüllt" if fk == 0 else "verfehlt"))
    for name in ("Leitstand, Spieler, MCP, Rechner, Analyse, Werkstatt sterben", "Wirt hängt oder stirbt",
                 "Deck-Vorlauf", "Dauerlauf 2 h"):
        zeilen.append((name, "ARCHITEKTUR §7", "–", "nicht in diesem Lauf (Scheiben 48, 54, 57, 31)"))
    return zeilen


def schreibe(ordner):
    o = Path(ordner)
    L = json.loads((o / "lauf.json").read_text())
    A = json.loads((o / "auswertung.json").read_text())
    p = L["profil"]
    z = [f"# Prüflauf {p['name']}", "", f"*{p['zweck']}*", "",
         f"Ergebnis: **{A['ergebnis']}**" + (" (vorläufig: Fremdlast über 4, wiederholen in M10)" if A.get("vorlaeufig") else ""),
         "", "## Aufbau", "",
         f"- Instanz `{p['instanz']}`, Senke `{L['senke']}` (Modul {L.get('senke_modul')}), Quantum {p['quantum']}, "
         f"{_z(p['bpm'])} BPM, Aufnahme {_z(p['dauer_s'])} s",
         f"- Quelle `{p['quelle']['art']}` `{p['quelle']['programm']}`, Neustart {p['quelle']['neustart']}",
         f"- Notbahn " + (f"daneben: `{' '.join(str(a) for a in L['notbahn_aufruf'][1:])}`" if L.get("notbahn_aufruf")
                          else "aus"),
         f"- Last {p['last']['profil'] or 'keine'}",
         f"- Fremdlast (1 min) vorher {_z(A['fremdlast']['vorher'], 2)}, nachher {_z(A['fremdlast']['nachher'], 2)}; "
         f"GPU vorher {A['fremdlast']['gpu_vorher']}, nachher {A['fremdlast']['gpu_nachher']}",
         f"- Fehler im Lauf: {A.get('fehler_im_lauf') or 'keiner'}", ""]
    ins = A.get("instrument", {})
    z += ["## Instrument", "", f"Aufnehmer: {ins.get('frames')} Frames, {ins.get('aufnehmer_luecken')} Lücken, "
          f"{ins.get('aufnehmer_ueberlauf')} Überläufe, Quantum {ins.get('quantum')}; {ins.get('klicks')} Klick-Einsätze.", ""]
    if A.get("eingriffe"):
        z += ["## Eingriffe", "", "| Nr | Art | Ziel | Stille ms | fehlende Klicks | Sprünge (max) | Schleife: Frames, "
              "abweichend, still | Raster Schleife | Raster Rückkehr | Notbahn-Zustände | Übernahmen | Takte max | "
              "letzter Klick ms |", "|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
        for i, m in enumerate(A["eingriffe"], 1):
            rs, rr, sl = m.get("raster_schleife"), m.get("raster_rueckkehr"), m.get("schleife")
            z.append(f"| {i} | {m['art']} | {m['ziel']} | {_z(m['stille']['laengste_ms'], 2)} | "
                     f"{_z(m['stille'].get('fehlende_klicks'))} | {m['spruenge']['anzahl']} ({_z(m['spruenge']['max'], 3)}) | "
                     f"{_schleife(sl)} | "
                     f"{_z(rs['versatz_samples']) if rs else '–'} | {_z(rr['versatz_samples']) if rr else '–'} | "
                     f"{m['notbahn']['zustaende']} | {m['notbahn']['uebernahmen']} | {m['notbahn']['takte_max']} | "
                     f"{_z(m.get('letzter_klick_nach_ms'))} |")
        z.append("")
    r = A.get("ruhe", {})
    z += ["## Rest des Laufs (Negativ-Kontrolle)", "",
          f"{_z(r.get('sekunden'))} s außerhalb der Eingriffe: Stille-Ereignisse {r.get('stille_ereignisse')}, "
          f"längste {_z(r.get('stille_laengste_ms'), 2)} ms, Sprünge {r.get('spruenge')} (größter natürlicher Schritt "
          f"{_z(r.get('spruenge_max_natuerlich'), 4)}), Raster-Streuung {_z(r.get('raster_streuung'))} Samples, "
          f"Notbahn-Übernahmen {r.get('notbahn_uebernahmen')}, fehlende Klicks {_z(r.get('fehlende_klicks'))}.", ""]
    k, qj = A.get("kern") or {}, A.get("quelle") or {}
    z += ["## Frame-Lücken", "",
          f"- Kern (`/zustand/kern`, SCHNITTSTELLEN §5.4): {k.get('frame_luecken', '–')} Lücken, "
          f"{k.get('ausgelassene_perioden', '–')} ausgelassene Perioden, {k.get('meldungen', 0)} Meldungen, "
          f"cb_max {k.get('cb_max_us', '–')} µs, Aufwachen max {k.get('aufwach_max_us', '–')} µs",
          f"- Prüfquelle (Journal): {qj.get('luecken', '–')} Lücken, {qj.get('spins', '–')} Spins, {qj.get('starts', '–')} Starts",
          f"- Aufnehmer: {ins.get('aufnehmer_luecken')}", ""]
    if A.get("last"):
        la = A["last"]
        z += ["## Lastprofil P1", "", "| Kennzahl | Wert |", "|---|---|"] + [f"| {kk} | {_z(v, 2)} |" for kk, v in la.items()] + [""]
    s = A.get("senke", {})
    z += ["## Senke und Reste", "", f"`pactl list short modules` vorher gleich nachher: **{s.get('module_gleich')}**; "
          f"eigene Änderungen: {s.get('eigene_aenderungen') or 'keine'}; fremde Änderungen (andere Sessions): "
          f"{s.get('fremde_aenderungen') or 'keine'}; Units übrig: {s.get('units_reste') or 'keine'}.", ""]
    z += ["## Erwartung dieses Profils", "", "| Schlüssel | Grenze | gemessen | Urteil |", "|---|---|---|---|"]
    z += [f"| {u['schluessel']} | {_z(u['grenze'])} | {_z(u['wert'], 2)} | {'erfüllt' if u['ok'] else 'VERFEHLT'} |"
          for u in A.get("urteile", [])] + [""]
    z += ["## Zusagen aus ARCHITEKTUR §7", "", "| Zusage | Grenze | gemessen | Urteil |", "|---|---|---|---|"]
    z += [f"| {a} | {b} | {c} | {d} |" for a, b, c, d in zusagen(L, A)] + [""]
    (o / "bericht.md").write_text("\n".join(z))
    return o / "bericht.md"
