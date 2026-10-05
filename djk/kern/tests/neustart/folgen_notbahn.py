#!/usr/bin/env python3
"""Golden-Folgen notbahn_124 und notbahn_rampe gegen den echten Kern (SCHNITTSTELLEN §19.3, Format
djk/vertrag/folgen/FORMAT.md mit der Zeilenart "aktion"). Übersetzt die Folge in einen Lauf von serie.sh (Tempo aus
/k/set/neu, Rampe aus /k/tempo/rampe, Abschuss-Sample aus "aktion kern_kill9") und prüft ihre Zeilen am Ziel:

  erwarte /nb ,iiih Zustand z   /nb mit Zustand z kommt beim Prüf-Abonnenten im Fenster [ab_sample, bis_sample],
                                gerechnet ab dem Abschuss (Empfangszeit, 48 Samples je ms)
  messung schleife_frames       Länge der Notbahn-Schleife am Ziel: die Verzögerung, um die das Prüfsignal im Cue
                                während der Schleife wiederkommt (exakt, Toleranz der Zeile)
  messung stille_ms             stille_ms aus auswertung.py
  messung rueckgabe_raster_abw_samples   raster_abw_samples (Klick) und cue_abw_samples aus auswertung.py
  erwarte /q ,hsihds id status  die Quittung mit diesem Status zum gesendeten Befehl gleicher Adresse kommt binnen
                                bis_sample − ab_sample nach dem Senden (der Prüf-Abonnent sendet die Befehle der
                                Folge früher als ihr Sample, gleich nach /k/set/neu; das Fenster gilt ab seinem Senden)
  sende, aktion                 führt serie.sh aus (Tempo, Rampe, Abschuss-Sample)
Jede andere Zeile (Schritt-Art, Adresse, Messgröße) ist rot: ein Läufer, der eine Zeile nicht kennt, überspringt sie
nicht still (FORMAT.md Punkt 16).

Aufruf: folgen_notbahn.py <folge.jsonl> [--nur-auswerten <lauf-ordner>]   (CYPHERDJ_INSTANZ gesetzt)
Rückgabe: 0 alle Zeilen grün, 1 mindestens eine rot, 2 Lauf oder Instrument unbrauchbar."""
import argparse
import glob
import json
import os
import subprocess
import sys

import numpy as np

HIER = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HIER)
import auswertung as A  # noqa: E402

RATE = 48000


def lies_folge(pfad):
    zeilen = [json.loads(z) for z in open(pfad) if z.strip()]
    bpm = next(z["osc"][4] for z in zeilen if z["t"] == "sende" and z["osc"][0] == "/k/set/neu")
    rampe = next(("{}:{}:{}".format(*z["osc"][4:7]) for z in zeilen if z["t"] == "sende"
                  and z["osc"][0] == "/k/tempo/rampe"), "")
    kill = next(z["sample"] for z in zeilen if z["t"] == "aktion" and z["was"] == "kern_kill9")
    return zeilen, bpm, rampe, kill


def schleife_frames(cue, a, e, erwartet, suche=2000):
    """Verzögerung L, um die das Signal in der Schleife [a, e) wiederkommt; None, wenn keine passt.
    Daneben (ADR 016 Nachtrag) kommt der Kern schon nach rund 20 ms zurück, und vor dem Ende e liegen rund 768 Samples
    doppelter Ton (Notbahn hält noch zwei Blöcke, blendet 256 Samples aus, der Kern blendet 256 ein; gemessen
    2026-09-26: rein nur die ersten 1024 von 1536 Samples). Darum das Fenster ab a + 16 bis höchstens e − 800."""
    von = a + 16
    bis = min(e - 800, von + 1024)
    if bis - von < 256:
        return None
    seg = cue[von:bis]
    for L in sorted(range(erwartet - suche, erwartet + suche + 1), key=lambda v: abs(v - erwartet)):
        if von - L < 0:
            continue
        if float(np.max(np.abs(seg - cue[von - L:bis - L]))) < A.GLEICH:
            return L
    return None


def pruefe(o, zeilen, kill_sample):
    erg, rc = A.werte(o)
    if rc == 2 or not erg["ereignisse"]:
        return [("instrument", False, erg["instrument"].get("fehler", "kein Ereignis"))], 2
    ev = erg["ereignisse"][0]
    ereignis = [json.loads(z) for z in open(os.path.join(o, "ereignisse.jsonl")) if z.strip()][0]
    t_kill = ereignis["t_ns"]
    abo = A.jsonl(os.path.join(o, "abonnent.jsonl"))
    nb = [(m["t"], m["w"][0]) for m in abo if m.get("adr") == "/nb" and m["t"] > t_kill]
    meta = json.load(open(os.path.join(o, "ziel.f32.json")))
    roh = np.fromfile(os.path.join(o, "ziel.f32"), dtype=np.float32)
    cue = roh[: len(roh) // 4 * 4].reshape(-1, 4)[:, 2]
    i_kill = int(round((t_kill - meta["erster_mono_ns"]) * RATE / 1e9))
    D = ev.get("versatz_samples", erg["instrument"]["versatz_samples"])  # Versatz dieses Eingriffs
    soll = A.pruef_cue(np.maximum(np.arange(i_kill, i_kill + 4 * RATE, dtype=np.int64) - D, 0))
    abw = np.flatnonzero(np.abs(cue[i_kill:i_kill + 4 * RATE] - soll) >= A.GLEICH)
    a = i_kill + int(abw[0]) if abw.size else None
    e = a + int(ev["unterbrochen_ms"] * RATE / 1000) if a is not None and ev.get("unterbrochen_ms") else None
    aus = []
    for z in zeilen:
        if z["t"] == "erwarte" and z["osc"][0] == "/nb":
            fenster_ns = (z["bis_sample"] - z.get("ab_sample", kill_sample)) * 1e9 / RATE
            zustand = z["osc"][2]
            treffer = [t for t, zu in nb if zu == zustand and t - t_kill <= fenster_ns]
            aus.append((f"/nb zustand {zustand} binnen {fenster_ns / 1e6:.0f} ms",
                        bool(treffer), f"{(treffer[0] - t_kill) / 1e6:.1f} ms" if treffer else "keins"))
        elif z["t"] == "erwarte" and z["osc"][0] == "/q":
            adresse = next(s["osc"][0] for s in zeilen if s["t"] == "sende" and s["osc"][2] == z["osc"][2])
            gesendet = next((m for m in abo if m.get("gesendet") == adresse), None)
            fenster_ns = (z["bis_sample"] - z["ab_sample"]) * 1e9 / RATE
            treffer = [m for m in abo if gesendet and m.get("adr") == "/q" and m["w"][0] == gesendet["w"][0]
                       and m["w"][2] == z["osc"][4] and 0 <= m["t"] - gesendet["t"] <= fenster_ns]
            aus.append((f"/q {adresse} Status {z['osc'][4]} binnen {fenster_ns / 1e6:.0f} ms nach dem Senden", bool(treffer),
                        f"{(treffer[0]['t'] - gesendet['t']) / 1e6:.1f} ms" if treffer else "keine"))
        elif z["t"] == "messung" and z["name"] == "schleife_frames":
            L = schleife_frames(cue, a, e, int(z["wert"])) if a is not None and e is not None else None
            aus.append(("schleife_frames", L is not None and abs(L - z["wert"]) <= z["toleranz"], f"{L} (soll {z['wert']})"))
        elif z["t"] == "messung" and z["name"] == "stille_ms":
            aus.append(("stille_ms", ev.get("stille_ms") == z["wert"], f"{ev.get('stille_ms')} (soll {z['wert']})"))
        elif z["t"] == "messung" and z["name"] == "rueckgabe_raster_abw_samples":
            r, c = ev.get("raster_abw_samples"), ev.get("cue_abw_samples")
            ok = r is not None and c is not None and abs(r - z["wert"]) <= z["toleranz"] and abs(c - z["wert"]) <= z["toleranz"]
            aus.append(("rueckgabe_raster_abw", ok, f"klick {r}, cue {c} (soll {z['wert']} ± {z['toleranz']})"))
        elif z["t"] in ("sende", "aktion"):
            continue
        else:
            aus.append((f"unbekannte Zeile {z['t']} {z.get('name') or z.get('osc', [''])[0]}", False, "nicht geprüft"))
    return aus, 0 if all(ok for _, ok, _ in aus) else 1


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("folge")
    ap.add_argument("--nur-auswerten", default="")
    a = ap.parse_args()
    zeilen, bpm, rampe, kill = lies_folge(a.folge)
    name = os.path.basename(a.folge).replace(".jsonl", "").replace("_", "-")
    if a.nur_auswerten:
        o = a.nur_auswerten
    else:
        cmd = [os.path.join(HIER, "serie.sh"), "--lauf", name, "--art", "kill", "--anzahl", "1", "--bpm", str(bpm),
               "--abschuss-bei", str(kill)]
        if rampe:
            cmd += ["--rampe", rampe]
        subprocess.run(cmd)
        o = sorted(glob.glob(os.path.join(HIER, "laeufe", name + "-*")))[-1]
    aus, rc = pruefe(o, zeilen, kill)
    for text, ok, wert in aus:
        print(f"{'PASS' if ok else 'FAIL'} {name}: {text}: {wert}")
    print(f"ERGEBNIS {name}", {0: "GRUEN", 1: "ROT", 2: "INSTRUMENT"}[rc], o)
    sys.exit(rc)


if __name__ == "__main__":
    main()
