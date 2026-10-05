// Kleiner Prüf-Kopf für CTest (SCHNITTSTELLEN.md §19.4: CTest mit eigenem Assert-Header, kein gtest).
// Jede Prüfung druckt Datei, Zeile und die Werte; das Programm endet mit 1, wenn eine fehlschlug.
#pragma once

#include <cmath>
#include <cstdio>
#include <cstdlib>

namespace pruef {
inline int& fehler() { static int n = 0; return n; }
inline int ende() {
    if (fehler() == 0) { std::printf("OK\n"); return 0; }
    std::printf("FEHLER: %d Prüfung(en) rot\n", fehler());
    return 1;
}
}  // namespace pruef

#define PRUEF(bed)                                                                   \
    do {                                                                             \
        if (!(bed)) {                                                                \
            std::printf("%s:%d: PRUEF(%s) rot\n", __FILE__, __LINE__, #bed);       \
            ++pruef::fehler();                                                       \
        }                                                                            \
    } while (0)

#define PRUEF_NAH(ist, soll, tol)                                                    \
    do {                                                                             \
        const double ist_ = (ist), soll_ = (soll), tol_ = (tol);                     \
        if (!(std::fabs(ist_ - soll_) <= tol_)) {                                    \
            std::printf("%s:%d: %s = %.9g, erwartet %.9g ± %.3g\n", __FILE__,        \
                        __LINE__, #ist, ist_, soll_, tol_);                          \
            ++pruef::fehler();                                                       \
        }                                                                            \
    } while (0)

#define PRUEF_KLEINER(ist, grenze)                                                   \
    do {                                                                             \
        const double ist_ = (ist), g_ = (grenze);                                    \
        if (!(ist_ < g_)) {                                                          \
            std::printf("%s:%d: %s = %.9g, erwartet < %.9g\n", __FILE__, __LINE__,   \
                        #ist, ist_, g_);                                             \
            ++pruef::fehler();                                                       \
        }                                                                            \
    } while (0)
