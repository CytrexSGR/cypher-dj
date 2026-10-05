"""berichte/messung.json -> Markdown-Tabellen (auf stdout). Der Bericht setzt sie ein."""
import json
import sys

NAMEN = {"detektor": "Detektor v1", "a16": "(a) alle 16-Takt-Grenzen",
         "b16": "(b) Zufall auf 16er, gleich viele (aufgefüllt)",
         "b16_ungefuellt": "Kontrolle: (b) alte Fassung, nicht aufgefüllt",
         "a16_versatz": "Kontrolle: 16er mit Detektor-Phrasenversatz", "b8": "Kontrolle: Zufall auf 8er, gleich viele",
         "b1": "Kontrolle: Zufall auf allen Takten, gleich viele"}


def pz(x):
    return f"{100 * x:.1f} %".replace(".", ",")


def tabelle(e, boot=None):
    z = ["| Verfahren | Trefferquote | Präzision (untere Schranke) | Vorschläge je Track | Treffer/Markierungen | nahe/Vorschläge | Δ Trefferquote 95 % | Δ Präzision 95 % |",
         "|---|---|---|---|---|---|---|---|"]
    for k, n in NAMEN.items():
        if k not in e:
            continue
        v = e[k]
        if k == "b16" and "b16_ungefuellt" not in e:   # alte messung.json: (b) war nicht aufgefuellt
            n = "(b) Zufall auf 16er, alte Fassung (nicht aufgefüllt)"
        ki_r = ki_p = ""
        if boot and k in boot:
            a, b = boot[k]["recall_diff_ki95"]
            c, d = boot[k]["praez_diff_ki95"]
            ki_r = f"[{100*a:+.1f}; {100*b:+.1f}] Pp".replace(".", ",")
            ki_p = f"[{100*c:+.1f}; {100*d:+.1f}] Pp".replace(".", ",")
        z.append(f"| {n} | {pz(v['recall'])} | {pz(v['praezision_min'])} | {v['je_track']:.1f}".replace(".", ",") + " | "
                 f"{v['treffer_marken']}/{v['marken']} | {v['treffer_vorschlaege']}/{v['vorschlaege']} | {ki_r} | {ki_p} |")
    return "\n".join(z)


def main(pfad):
    j = json.load(open(pfad))
    print("## test\n")
    print(tabelle(j["test"], j["test_bootstrap"]))
    s = j["test"].get("b16_saaten")
    if s:
        print(f"\n(b) über {s['n']} Saaten: Trefferquote {pz(s['recall_mittel'])} ± {pz(s['recall_sd'])} (max {pz(s['recall_max'])}), "
              f"Präzision {pz(s['praez_mittel'])} ± {pz(s['praez_sd'])} (max {pz(s['praez_max'])})")
    print("\n## cues\n")
    print(tabelle(j["cues"], j["cues_bootstrap"]))
    s = j["cues"].get("b16_saaten")
    if s:
        print(f"\n(b) über {s['n']} Saaten: Trefferquote {pz(s['recall_mittel'])} ± {pz(s['recall_sd'])}, "
              f"Präzision {pz(s['praez_mittel'])} ± {pz(s['praez_sd'])}")
    print("\n## raster-rueckfall\n")
    print(tabelle(j["raster_rueckfall_test"]))
    print("\n## ablation\n")
    for k, v in j["ablation_test"].items():
        print(f"- {k}: Trefferquote {pz(v['recall'])}, Präzision {pz(v['praezision_min'])}, {v['je_track']:.1f} je Track")
    print("\n## klassen\n")
    for k, v in sorted(j["klassen_test"].items(), key=lambda x: -x[1]["n"]):
        print(f"- {k}: {v['n']} Vorschläge, {v['nahe_markierung']} nahe Markierung ({pz(v['nahe_markierung']/max(v['n'],1))})")


def nachmessung(pfad="berichte/nachmessung.json"):
    j = json.load(open(pfad))
    for menge in ("test", "cues", "frisch", "gepoolt"):
        for vn in ("v1", "v2"):
            x = j[f"{menge}_{vn}"]
            print(f"\n### {menge}, Detektor {vn}\n")
            print(tabelle(x["kennzahlen"], x["bootstrap"]).replace("Detektor v1", f"Detektor {vn}"))
            s = x["kennzahlen"].get("b16_saaten")
            if s:
                print(f"\n(b) über {s['n']} Saaten: Trefferquote {pz(s['recall_mittel'])} ± {pz(s['recall_sd'])} "
                      f"(max {pz(s['recall_max'])}), Präzision {pz(s['praez_mittel'])} ± {pz(s['praez_sd'])} "
                      f"(max {pz(s['praez_max'])}); Saaten mindestens so gut wie der Detektor: "
                      f"{s['detektor_recall_rang']} (Trefferquote), {s['detektor_praez_rang']} (Präzision)")
            u = x["urteil"]
            print(f"\nUrteil: Punktwerte {'bestanden' if u['bestanden_punkt'] else 'NICHT bestanden'}, "
                  f"signifikant {'bestanden' if u['bestanden_signifikant'] else 'NICHT bestanden'}")
    print("\n### Empfindlichkeit (v1)\n")
    print("| Menge, Kante | Detektor | (a) | (b) |\n|---|---|---|---|")
    for k, v in j["empfindlichkeit"].items():
        print(f"| {k} | " + " | ".join(f"{pz(v[x]['recall'])} / {pz(v[x]['praez'])}" for x in ("detektor", "a16", "b16")) + " |")


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "nachmessung":
        nachmessung(*sys.argv[2:])
    else:
        main(sys.argv[1] if len(sys.argv) > 1 else "berichte/messung.json")
