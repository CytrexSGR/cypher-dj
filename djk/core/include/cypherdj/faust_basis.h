// Die drei Typen, die Faust-erzeugter Code (-scn FaustBasis) voraussetzt. Metadaten braucht der Kern nicht (leer). Die
// Bedienoberfläche merkt sich nur die Regler-Zonen (hslider) unter ihrem Label: kleine feste Tabelle, keine Allokation.
// Probe 2026-09-30: zita_rev1 baut damit ohne weitere Abhängigkeit (der Hall hat keine Regler).
#pragma once
#include <cstring>
namespace cdjfaust {   // nicht global: OpenSSLs `typedef struct ui_st UI;` kollidiert sonst
struct Meta { void declare(const char*, const char*) {} };
struct UI {
  static constexpr int kZonen = 8;
  const char* zone_name[kZonen] = {};
  float* zone_ptr[kZonen] = {};
  int zone_n = 0;
  void addHorizontalSlider(const char* label, float* zone, float, float, float, float) {
    if (zone_n < kZonen) {
      zone_name[zone_n] = label;
      zone_ptr[zone_n++] = zone;
    }
  }
  float* zone(const char* label) const {   // nullptr, wenn es den Regler nicht gibt
    for (int i = 0; i < zone_n; ++i)
      if (!std::strcmp(zone_name[i], label)) return zone_ptr[i];
    return nullptr;
  }
  void openVerticalBox(const char*) {}
  void openHorizontalBox(const char*) {}
  void closeBox() {}
};
struct FaustBasis { virtual ~FaustBasis() = default; };
}  // namespace cdjfaust
