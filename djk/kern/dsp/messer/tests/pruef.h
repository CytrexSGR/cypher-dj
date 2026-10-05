// Kleiner Prüf-Kopf für die Tests von Scheibe 14 (gtest/catch2 fehlen auf DJ-Maschine, SCHNITTSTELLEN 19.4).
#pragma once
#include <cmath>
#include <cstdio>

inline int g_pruef_fehler = 0;

#define PRUEFE(bed)                                                                    \
  do {                                                                                 \
    if (!(bed)) {                                                                      \
      std::fprintf(stderr, "%s:%d: PRUEFE(%s) verletzt\n", __FILE__, __LINE__, #bed); \
      ++g_pruef_fehler;                                                                \
    }                                                                                  \
  } while (0)

#define PRUEFE_NAHE(a, b, tol)                                                                          \
  do {                                                                                                  \
    const double pa_ = (a), pb_ = (b), pt_ = (tol);                                                     \
    if (!(std::fabs(pa_ - pb_) <= pt_)) {                                                               \
      std::fprintf(stderr, "%s:%d: %s = %.9g, %s = %.9g, Abstand %.3g > %.3g\n", __FILE__, __LINE__, #a, \
                   pa_, #b, pb_, std::fabs(pa_ - pb_), pt_);                                            \
      ++g_pruef_fehler;                                                                                 \
    }                                                                                                   \
  } while (0)

inline int pruef_ende(const char* name) {
  if (g_pruef_fehler) {
    std::printf("%s: ROT, %d Fehler\n", name, g_pruef_fehler);
    return 1;
  }
  std::printf("%s: GRUEN\n", name);
  return 0;
}
