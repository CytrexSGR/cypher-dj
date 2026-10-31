#!/usr/bin/env python3
"""D1 K3 Fix 2/P2: statische Prüfung der Echtzeit-Quellen des Arrangements und des Freeze.

Der Laufzeit-Wächter (alloc_abfang.h) sieht ein Futex-Primitiv nur, wenn es in den Kernel geht: eine unbelastete
std::binary_semaphore, ein std::latch oder ein std::atomic::wait, das nicht warten muss, bleiben ungezählt (gemessen:
1000-mal genommen, 0 gezählt; ~/messungen/2026-10-15-d1-k3/fix2/p2_waechter_grenze.txt). Diese Prüfung schließt die
Lücke von der Quelle her: keine Datei der Liste und keiner der Köpfe aus djk/kern/include, die sie über
#include "cypherdj/..." (transitiv) einbindet, bindet <mutex>, <shared_mutex>, <condition_variable>, <semaphore>, <latch>
oder <barrier> ein oder ruft .wait / .acquire (und ihre Verwandten) auf, noch die freien Warte-Funktionen aus <atomic>:
std::atomic_wait, std::atomic_wait_explicit, std::atomic_flag_wait, std::atomic_flag_wait_explicit (Fix 3/Q1; mit oder
ohne std::, auch mit Vorlagen-Argument). Die Weck-Funktionen (atomic_notify_*, .notify_*) blockieren nicht und bleiben
erlaubt.

Positiv-Kontrolle im Lauf: Kopien von src/arr_freeze.cpp mit #include <semaphore>, mit einem .acquire() und mit je einer
der vier freien Warte-Funktionen in Arrangement::freeze_abgriff müssen je einen Treffer liefern, sonst ist das Instrument
blind und der Test scheitert. Negativ-Kontrollen: dieselben Formen nur im Kommentar, std::atomic_notify_one und ein
fremder Name, der auf atomic_wait endet, dürfen nicht treffen.

Aufruf: test_echtzeit_quellen.py [--wurzel <djk/kern>]   (Rückgabe 0: alles grün)
"""
import argparse
import pathlib
import re
import sys
import tempfile

HIER = pathlib.Path(__file__).resolve().parent

# Echtzeit-Quellen: was Kern::zyklus() für Arrangement und Freeze durchläuft (Spec 2.2, 3.1, 6.29: keine Allokation,
# keine Sperre, kein I/O im Callback). Nicht darin: arr_lader.cpp, arr_freeze_datei.cpp, arr_wiedergabe.cpp und
# netz_arr*.cpp (Lade- und Netz-Faden, dort sind Sperren und I/O erlaubt).
ECHTZEIT = [
    "src/kern.cpp",
    "src/kern_arr.cpp",
    "src/arrangement.cpp",
    "src/arr_stimmen.cpp",
    "src/arr_warp.cpp",   # 1.13 Slice 2: Seite des Arrangements am Warp-Werk (nicht warp_werk.cpp: das ist der Arbeitsfaden)
    "src/arr_ausgang.cpp",
    "src/arr_noten.cpp",
    "src/arr_metronom.cpp",
    "src/arr_freeze.cpp",
    "src/arr_rb_senke.cpp",
    "src/arr_wirt_senke.cpp",
    "include/cypherdj/arrangement.h",
    "include/cypherdj/warp_werk.h",
    "include/cypherdj/arr_rb_senke.h",
    "include/cypherdj/arr_wirt_senke.h",
    "src/erzeuger.cpp",             # Baukasten S3a: Erzeuger-Ströme mit Graph laufen im Callback
    "include/cypherdj/erzeuger.h",
]

KOEPFE = ("mutex", "shared_mutex", "condition_variable", "semaphore", "latch", "barrier")
VERBOTEN_KOPF = re.compile(r"^\s*#\s*include\s*<(" + "|".join(KOEPFE) + r")>")
# .wait( .acquire( .try_acquire( .try_acquire_for( .try_acquire_until( .arrive_and_wait(, auch über ->
VERBOTEN_RUF = re.compile(r"(\.|->)\s*(wait|acquire|try_acquire|try_acquire_for|try_acquire_until|arrive_and_wait)\s*\(")
# Fix 3/Q1: freie Formen aus <atomic> (C++20): std::atomic_wait(&a, v), std::atomic_wait_explicit(&a, v, o),
# std::atomic_flag_wait(&f, v), std::atomic_flag_wait_explicit(&f, v, o); auch ohne std:: (using) und mit <T>
VERBOTEN_FREI = re.compile(r"\b(atomic_wait|atomic_wait_explicit|atomic_flag_wait|atomic_flag_wait_explicit)\s*(<[^;()]*>)?\s*\(")
EIGENER_KOPF = re.compile(r'^\s*#\s*include\s*"(cypherdj/[^"]+)"')


def ohne_kommentar(zeile, im_block):
    """Zeile ohne // und /* */-Kommentare (Zeichenketten mit // kommen in diesen Quellen nicht vor)."""
    aus = []
    i = 0
    while i < len(zeile):
        if im_block:
            j = zeile.find("*/", i)
            if j < 0:
                return "".join(aus), True
            i = j + 2
            im_block = False
        elif zeile.startswith("//", i):
            break
        elif zeile.startswith("/*", i):
            im_block = True
            i += 2
        else:
            aus.append(zeile[i])
            i += 1
    return "".join(aus), im_block


def pruefe(wurzel, liste, ersatz=None):
    """Treffer als Liste von (Datei, Zeile, Text). ersatz: {relativer Pfad: Pfad} für die Positiv-Kontrolle."""
    ersatz = ersatz or {}
    treffer, gesehen, offen, fehlt = [], set(), list(liste), []
    while offen:
        rel = offen.pop()
        if rel in gesehen:
            continue
        gesehen.add(rel)
        pfad = pathlib.Path(ersatz.get(rel, wurzel / rel))
        if not pfad.exists():
            fehlt.append(rel)
            continue
        im_block = False
        for nr, roh in enumerate(pfad.read_text(encoding="utf-8").splitlines(), 1):
            m = EIGENER_KOPF.match(roh)
            if m:
                offen.append("include/" + m.group(1))
            code, im_block = ohne_kommentar(roh, im_block)
            if VERBOTEN_KOPF.match(code) or VERBOTEN_RUF.search(code) or VERBOTEN_FREI.search(code):
                treffer.append((rel, nr, roh.strip()))
    return treffer, sorted(gesehen), fehlt


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--wurzel", default=str(HIER.parent))
    wurzel = pathlib.Path(ap.parse_args().wurzel).resolve()
    fehler = 0

    treffer, gesehen, fehlt = pruefe(wurzel, ECHTZEIT)
    for rel in fehlt:
        if rel in ECHTZEIT:   # ein Name der Liste fehlt: die Liste ist veraltet
            print(f"GESCHEITERT: {rel} aus der Liste fehlt")
            fehler += 1
    for rel, nr, text in treffer:
        print(f"GESCHEITERT: {rel}:{nr}: {text}")
        fehler += 1
    print(f"geprüft: {len(gesehen)} Dateien ({len(ECHTZEIT)} aus der Liste, der Rest eingebunden), Treffer {len(treffer)}")

    # Positiv-Kontrolle: das Instrument muss je eine eingesetzte Verletzung finden (und die Negativ-Proben übergehen)
    quelle = (wurzel / "src/arr_freeze.cpp").read_text(encoding="utf-8")
    kopf = "void Arrangement::freeze_abgriff(int64_t s0, int m) {"

    def frei(ruf):   # ein Warte-Ruf als erste Zeile von Arrangement::freeze_abgriff
        assert kopf in quelle, "freeze_abgriff nicht gefunden: Probe passt nicht mehr zur Quelle"
        return quelle.replace(kopf, kopf + "\n  " + ruf, 1)

    proben = {
        "#include <semaphore>": (quelle.replace("#include <cmath>", "#include <cmath>\n#include <semaphore>", 1), 1),
        "s.acquire()": (quelle.replace("namespace cdj {", "namespace cdj {\nvoid probe(S& s) { s.acquire(); }", 1), 1),
        # Fix 3/Q1: die freien Warte-Funktionen aus <atomic> (C++20), je Form eine Probe
        "std::atomic_wait": (frei("std::atomic_wait(&a, 1);"), 1),
        "std::atomic_wait_explicit": (frei("std::atomic_wait_explicit(&a, 1, std::memory_order_acquire);"), 1),
        "std::atomic_flag_wait": (frei("std::atomic_flag_wait(&f, true);"), 1),
        "std::atomic_flag_wait_explicit": (frei("std::atomic_flag_wait_explicit(&f, true, std::memory_order_acquire);"), 1),
        "atomic_wait<int> (ohne std::, mit Vorlagen-Argument)": (frei("atomic_wait<int>(&a, 1);"), 1),
        # Negativ-Kontrollen: dürfen nicht treffen
        "nur im Kommentar": (quelle.replace("#include <cmath>", "#include <cmath>\n// #include <mutex>", 1), 0),
        "atomic_wait nur im Kommentar": (frei("// std::atomic_wait(&a, 1);  /* std::atomic_flag_wait(&f, true); */"), 0),
        "std::atomic_notify_one (weckt nur)": (frei("std::atomic_notify_one(&a);"), 0),
        "mein_atomic_wait (fremder Name)": (frei("mein_atomic_wait(&a, 1);"), 0),
    }
    with tempfile.TemporaryDirectory() as tmp:
        for name, (text, soll) in proben.items():
            p = pathlib.Path(tmp) / "arr_freeze.cpp"
            p.write_text(text, encoding="utf-8")
            t, _, _ = pruefe(wurzel, ECHTZEIT, {"src/arr_freeze.cpp": p})
            n = sum(1 for rel, _, _ in t if rel == "src/arr_freeze.cpp")
            art = "Positiv" if soll else "Negativ"
            print(f"{art}-Kontrolle {name}: {n} Treffer (soll {soll})")
            if n != soll:
                print(f"GESCHEITERT: {art}-Kontrolle {name}")
                fehler += 1

    print("alle Pruefungen gruen" if fehler == 0 else f"{fehler} Pruefung(en) gescheitert")
    return 1 if fehler else 0


if __name__ == "__main__":
    sys.exit(main())
