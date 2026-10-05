#!/usr/bin/env python3
"""Fasst einen Abnahme-Ordner der Scheibe 08 zusammen (von abnahme.sh erzeugt) und urteilt nach dem Steckbrief 08.
Schreibt <ordner>/bericht.json und gibt die ABNAHME-Zeilen für docs/architektur/stand/08-kern-befehle.md aus
(ROADMAP §8.8: je Abnahmepunkt eine Zeile mit Zahl und Beleg-Pfad).
Aufruf: bericht.py <abnahme-ordner>   Rückgabe 0 bestanden (vorläufig zählt als bestanden, steht aber dabei), 1 sonst.
"""
import json
import os
import re
import sys


def lies(d: str, name: str) -> str:
    p = os.path.join(d, name)
    return open(p, errors="replace").read() if os.path.exists(p) else ""


def lade(d: str, name: str):
    p = os.path.join(d, name)
    return json.load(open(p)) if os.path.exists(p) else None


def last(meta: str) -> list[float]:
    return [float(x.replace(",", ".")) for x in re.findall(r"uptime_\w+=.*load average: (\d+[.,]\d+)", meta)]


def folgen(d: str, name: str) -> dict:
    """Ergebnis eines folgen_lauf.sh: je Folge grün/rot und die Quittungen je Kennung."""
    b = lade(d, f"{name}.json") or []
    return {os.path.basename(f["folge"]): {"gruen": f["gruen"], "quittungen": f["quittungen"],
                                           "rot_bei": [s for s in f["schritte"] if not s["ok"]][:1]} for f in b}


def main() -> int:
    d = sys.argv[1]
    p, beleg, lasten = {}, {}, []
    for meta in [f for f in os.listdir(d) if f.endswith(".meta")] + [
            os.path.join(x, "meta.txt") for x in os.listdir(d) if os.path.isdir(os.path.join(d, x))]:
        lasten += last(lies(d, meta))
    p["ctest"] = "100% tests passed" in lies(d, "ctest_kern.txt") and "100% tests passed" in lies(d, "ctest_kern_asan.txt")
    beleg["ctest"] = "ctest_kern.txt, ctest_kern_asan.txt"
    tsan, tsan_mut = lies(d, "tsan.txt"), lies(d, "tsan_mutation.txt")
    p["tsan"] = "rueckgabe=0" in tsan and "data race" not in tsan and "data race" in tsan_mut
    beleg["tsan"] = "tsan.txt, tsan_mutation.txt"
    p["laeufer"] = bool(re.search(r"\b\d+ passed\b", lies(d, "laeufer.txt"))) and "failed" not in lies(d, "laeufer.txt")
    beleg["laeufer"] = "laeufer.txt"
    toml = lies(d, "toml_tippfehler.txt")
    p["toml"] = "unbekannter Schlüssel 'start_bmp'" in toml and "rueckgabe=2" in toml
    beleg["toml"] = "toml_tippfehler.txt"

    f08, f01, fmut, fkv = folgen(d, "folgen08"), folgen(d, "folgen01"), folgen(d, "folgen_mut"), folgen(d, "karte_voll")
    drei = ["uhr_golden.jsonl", "storno.jsonl", "protokollfehler.jsonl"]
    p["folgen_gruen"] = all(f08.get(n, {}).get("gruen") for n in drei)
    p["folgen_01_rot"] = all(n in f01 and not f01[n]["gruen"] for n in drei)
    p["mutation_uhr_golden_rot"] = "uhr_golden.jsonl" in fmut and not fmut["uhr_golden.jsonl"]["gruen"]
    q = f08.get("uhr_golden.jsonl", {}).get("quittungen", {})
    qs = f08.get("storno.jsonl", {}).get("quittungen", {})
    p["puenktlich_nur_1_2_3"] = q.get("2") == [1, 2, 3] and qs.get("4") == [1, 2, 3]
    kv = fkv.get("karte_voll.jsonl", {})
    p["karte_voll"] = bool(kv.get("gruen")) and kv.get("quittungen", {}).get("64") == [6]
    beleg.update({"folgen_gruen": "folgen08.txt, folgen08.json", "folgen_01_rot": "folgen01.txt",
                  "mutation_uhr_golden_rot": "folgen_mut.txt", "puenktlich_nur_1_2_3": "folgen08.json (quittungen)",
                  "karte_voll": "karte_voll.txt, karte_voll.json"})

    kr, krm = lade(d, "klick_rampe/ergebnis.json") or {}, lade(d, "klick_rampe_mut/ergebnis.json") or {}
    p["klick_rampe_33"] = (kr.get("ergebnis") == "gruen" and kr.get("in_rampe_klicks") == 33
                           and kr.get("in_rampe_auf_versatz") == 33 and kr.get("streuung_samples") == 0)
    p["klick_rampe_mutation_rot"] = krm.get("ergebnis") == "rot" and (krm.get("streuung_samples") or 0) > 0
    beleg.update({"klick_rampe_33": "klick_rampe/ergebnis.json", "klick_rampe_mutation_rot": "klick_rampe_mut/ergebnis.json"})

    ll, lh, rl = (lade(d, f"{n}/ergebnis.json") or {} for n in ("luecken_last", "luecken_halb", "ruhelauf"))
    p["luecken_gezaehlt"] = ll.get("ergebnis") == "gruen"
    p["luecken_halb_0"] = lh.get("ergebnis") == "gruen"
    p["ruhelauf_0"] = rl.get("ergebnis") == "gruen"
    beleg.update({"luecken_gezaehlt": "luecken_last/ergebnis.json", "luecken_halb_0": "luecken_halb/ergebnis.json",
                  "ruhelauf_0": "ruhelauf/ergebnis.json"})
    fremdlast_max = max(lasten) if lasten else None
    vorlaeufig = fremdlast_max is None or fremdlast_max > 4.0
    # Eine Negativ-Kontrolle (halbe Last, Ruhelauf) mit Lücken unter Fremdlast über 4 ist vorläufig, wenn jede Lücke
    # ein Treiberwechsel ist (zyklen 0, fremde Graph-Ereignisse; Befund B4 im Plan), der Kern keinen Zyklus ausgelassen
    # hat und Ziel und Kern übereinstimmen: sie wandert nach M10 (Scheibe 61).
    def nur_fremd(r: dict, ok: bool) -> bool:
        return (not ok and vorlaeufig and r.get("ausgelassen_laut_kern") == 0 and r.get("ergebnis") == "rot"
                and not r.get("klicks_ausserhalb_rahmen") and r.get("treiberwechsel_laut_kern", 0) >= 1)
    halb_fremd, ruhe_fremd = nur_fremd(lh, p["luecken_halb_0"]), nur_fremd(rl, p["ruhelauf_0"])
    zahlen = {
        "folgen_gruen": f"{sum(1 for n in drei if f08.get(n, {}).get('gruen'))} von 3 grün",
        "folgen_01_rot": f"{sum(1 for n in drei if n in f01 and not f01[n]['gruen'])} von 3 rot",
        "mutation_uhr_golden_rot": f"rot bei {fmut.get('uhr_golden.jsonl', {}).get('rot_bei')}",
        "puenktlich_nur_1_2_3": f"uhr_golden id 2 {q.get('2')}, storno id 4 {qs.get('4')}",
        "karte_voll": f"63. Rampe {kv.get('quittungen', {}).get('64')}",
        "klick_rampe_33": f"{kr.get('in_rampe_auf_versatz')} von {kr.get('in_rampe_klicks')} auf Versatz "
                          f"{kr.get('versatz_samples')}, Streuung {kr.get('streuung_samples')}",
        "klick_rampe_mutation_rot": f"Streuung {krm.get('streuung_samples')}, {krm.get('in_rampe_auf_versatz')} auf Versatz",
        "luecken_gezaehlt": f"am Ziel {ll.get('ausgelassen_am_ziel')}, Kern {ll.get('ausgelassen_laut_kern')}, "
                            f"erwartet {ll.get('verbrennungen_im_fenster_erwartet')}",
        "luecken_halb_0": f"am Ziel {lh.get('ausgelassen_am_ziel')}, Kern frame_luecken {lh.get('zustand_frame_luecken')}, "
                          f"Treiberwechsel {lh.get('treiberwechsel_laut_kern')}",
        "ruhelauf_0": f"am Ziel {rl.get('ausgelassen_am_ziel')}, Kern frame_luecken {rl.get('zustand_frame_luecken')}, "
                      f"Treiberwechsel {rl.get('treiberwechsel_laut_kern')}",
        "toml": "Startfehler mit 'start_bmp', Rückgabe 2" if p["toml"] else "nicht erfüllt",
    }
    bestanden = (all(v for k, v in p.items() if k not in ("luecken_halb_0", "ruhelauf_0"))
                 and (p["luecken_halb_0"] or halb_fremd) and (p["ruhelauf_0"] or ruhe_fremd))
    b = {"ordner": d, "pruefung": p, "zahlen": zahlen, "beleg": beleg, "fremdlast_max": fremdlast_max,
         "vorlaeufig": vorlaeufig, "halb_nur_fremde_treiberwechsel": halb_fremd,
         "ruhelauf_nur_fremde_treiberwechsel": ruhe_fremd, "bestanden": bestanden}
    json.dump(b, open(os.path.join(d, "bericht.json"), "w"), ensure_ascii=False, indent=1)
    for k, v in p.items():
        print(f"ABNAHME: {k}: {'ja' if v else 'NEIN'} ({zahlen.get(k, '')}) Beleg {os.path.join(d, beleg[k])}")
    print(f"FREMDLAST: max {fremdlast_max} (1-min-Last, alle Läufe){' -> vorläufig, M10' if vorlaeufig else ''}")
    fremd = [n for n, f in (("halbe Last", halb_fremd), ("Ruhelauf", ruhe_fremd)) if f]
    print(f"ERGEBNIS: {'bestanden' if bestanden else 'NICHT bestanden'}"
          f"{' (' + ' und '.join(fremd) + ' nur mit fremden Treiberwechseln, vorläufig)' if fremd else ''}")
    return 0 if bestanden else 1


if __name__ == "__main__":
    sys.exit(main())
