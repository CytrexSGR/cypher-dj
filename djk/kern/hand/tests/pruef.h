// Eigener Assert-Kopf für CTest (SCHNITTSTELLEN §19 Punkt 4: gtest und catch2 fehlen auf DJ-Maschine), gleiche Form wie
// djk/kern/stellwerk/tests/pruef.h: jeder Fall druckt "OK   <name>" oder "ROT  <name>"; die Mutationsmatrix liest das.
#pragma once
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <vector>

namespace pruef {

struct Fall {
  const char* name;
  void (*f)();
};
inline std::vector<Fall>& faelle() {
  static std::vector<Fall> v;
  return v;
}
inline int& fehler() {
  static int n = 0;
  return n;
}
struct Anmeldung {
  Anmeldung(const char* n, void (*f)()) { faelle().push_back({n, f}); }
};

inline int alle(int argc, char** argv) {
  int gruen = 0, gesamt = 0;
  for (const Fall& f : faelle()) {
    if (argc > 1 && std::strstr(f.name, argv[1]) == nullptr) continue;
    const int vorher = fehler();
    f.f();
    const bool ok = fehler() == vorher;
    std::printf("%s %s\n", ok ? "OK  " : "ROT ", f.name);
    gesamt++;
    gruen += ok;
  }
  std::printf("%d von %d Faellen gruen\n", gruen, gesamt);
  return gruen == gesamt ? 0 : 1;
}

}  // namespace pruef

#define FALL(name)                                        \
  static void name();                                     \
  static pruef::Anmeldung anmeldung_##name(#name, name);  \
  static void name()

#define PRUEFE(bed)                                                                  \
  do {                                                                               \
    if (!(bed)) {                                                                    \
      std::printf("  verfehlt %s:%d: %s\n", __FILE__, __LINE__, #bed);               \
      pruef::fehler()++;                                                             \
    }                                                                                \
  } while (0)

#define PRUEFE_GLEICH(a, b)                                                                            \
  do {                                                                                                 \
    const long long a_ = static_cast<long long>(a), b_ = static_cast<long long>(b);                    \
    if (a_ != b_) {                                                                                    \
      std::printf("  verfehlt %s:%d: %s = %lld, erwartet %lld\n", __FILE__, __LINE__, #a, a_, b_);   \
      pruef::fehler()++;                                                                               \
    }                                                                                                  \
  } while (0)

#define PRUEFE_NAH(a, b, eps)                                                                                    \
  do {                                                                                                           \
    const double a_ = static_cast<double>(a), b_ = static_cast<double>(b);                                       \
    if (!(std::fabs(a_ - b_) <= (eps))) {                                                                        \
      std::printf("  verfehlt %s:%d: %s = %.9g, erwartet %.9g (+-%g)\n", __FILE__, __LINE__, #a, a_, b_,        \
                  static_cast<double>(eps));                                                                     \
      pruef::fehler()++;                                                                                         \
    }                                                                                                            \
  } while (0)

#define PRUEF_MAIN \
  int main(int argc, char** argv) { return pruef::alle(argc, argv); }
