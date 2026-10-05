// Eigener Assert-Header für CTest (SCHNITTSTELLEN.md §19.4: gtest und catch2 fehlen auf DJ-Maschine).
#pragma once
#include <cmath>
#include <cstdio>

static int pruef_fehler = 0;

#define PRUEF(bed)                                                                              \
  do {                                                                                          \
    if (!(bed)) {                                                                               \
      std::fprintf(stderr, "%s:%d: PRUEF(%s) gescheitert\n", __FILE__, __LINE__, #bed);        \
      ++pruef_fehler;                                                                           \
    }                                                                                           \
  } while (0)

#define PRUEF_NAH(ist, soll, tol)                                                               \
  do {                                                                                          \
    const double pr_i = (ist), pr_s = (soll);                                                   \
    if (!(std::fabs(pr_i - pr_s) <= (tol))) {                                                   \
      std::fprintf(stderr, "%s:%d: %s = %.9f, erwartet %.9f (Toleranz %g)\n", __FILE__,         \
                   __LINE__, #ist, pr_i, pr_s, (double)(tol));                                  \
      ++pruef_fehler;                                                                           \
    }                                                                                           \
  } while (0)

#define PRUEF_ENDE()                                                                            \
  do {                                                                                          \
    if (pruef_fehler) {                                                                         \
      std::fprintf(stderr, "%d Pruefung(en) gescheitert\n", pruef_fehler);                      \
      return 1;                                                                                 \
    }                                                                                           \
    std::printf("alle Pruefungen gruen\n");                                                     \
    return 0;                                                                                   \
  } while (0)
