// Prüft osc_adressen.h zur Übersetzungszeit: g++ -std=c++20 -fsyntax-only -Wall -Wextra -Werror -pedantic
#include "../osc_adressen.h"

namespace o = cypherdj::osc;

static_assert(o::vertrag == 1);
static_assert(o::alle.size() == 63, "63 Adressen aus §4, §5, §19.0 samt Z1");
static_assert(o::k_teil.pfad == "/k/teil" && o::k_teil.typen == ",hssisddfiiss" && o::k_teil.felder == 12);
static_assert(o::feld::k_teil::hoerschein == 11 && o::feld::q::grund == 5);
static_assert(o::finde("/k/tempo/rampe") != nullptr && o::finde("/k/tempo/rampe")->typen == ",hsddd");
static_assert(o::finde("/k/gibt_es_nicht") == nullptr);
static_assert(o::test_klick.nur_pruefmodus && !o::q.nur_pruefmodus);
static_assert(o::nb.richtung == o::Richtung::von_notbahn && o::k_willkommen.richtung == o::Richtung::vom_kern);
static_assert(o::bereich::k_tempo_rampe::ziel_bpm_min == 60.0 && o::bereich::k_tempo_rampe::ziel_bpm_max == 200.0);
static_assert(static_cast<int>(o::werte::Status::storniert) == 8);
static_assert(static_cast<int>(o::werte::Politik::raster) == 2);
static_assert(o::werte::gruende.size() == 40);

consteval bool alle_typen_passen() {
  for (const auto& a : o::alle) {
    if (a.typen.empty() || a.typen[0] != ',' || a.typen.size() - 1 != a.felder) return false;
    for (char c : a.typen.substr(1))
      if (c != 'i' && c != 'h' && c != 'f' && c != 'd' && c != 's') return false;
  }
  return true;
}
static_assert(alle_typen_passen());

int main() { return 0; }
