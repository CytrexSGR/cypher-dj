// 1.15 A1b: the Mixer maps every one of the 345 mix-tool rows of the controller table to (tool, field, channel) and gives
// each its own slot. The expectation (suffix -> tool and field inside the tool) is written out here, not read from
// werkzeug_regler.h: a swapped suffix in the table has to turn this test red.
//   (f1) no new row maps to MixRolle::spaeter (nor to ohne, kanalzug, komp)
//   (f2) tool, field and channel of every row equal the literal expectation below
//   (f3) the slots are distinct: a unique value written per row reads back from that row only
//   (f4) the defaults reach the slots (the constructor ends in setze_sofort(r, vorgabe))
//   Negative control: the old rows keep their roles (deck/1/fader is a kanalzug, deck/1/komp/an a komp).
#include <cstring>
#include <memory>

#include "cypherdj/mixer.h"
#include "pruef.h"

namespace sw = cypherdj::stellwerk;

namespace {
struct E {
  const char* suffix;
  sw::WzTool tool;
  int feld;   // index inside the tool
};
const E ERWARTET[] = {
    {"gate/an", sw::WzTool::gate, 0},          {"gate/schwelle", sw::WzTool::gate, 1},      {"gate/hysterese", sw::WzTool::gate, 2},
    {"gate/ratio", sw::WzTool::gate, 3},       {"gate/bereich", sw::WzTool::gate, 4},       {"gate/attack", sw::WzTool::gate, 5},
    {"gate/hold", sw::WzTool::gate, 6},        {"gate/release", sw::WzTool::gate, 7},       {"gate/sc", sw::WzTool::gate, 8},
    {"util/balance", sw::WzTool::utility, 0},  {"util/breite", sw::WzTool::utility, 1},     {"util/bassmono", sw::WzTool::utility, 2},
    {"util/phase_l", sw::WzTool::utility, 3},  {"util/phase_r", sw::WzTool::utility, 4},    {"util/tausch", sw::WzTool::utility, 5},
    {"util/dc", sw::WzTool::utility, 6},
    {"mb/an", sw::WzTool::multiband, 0},       {"mb/grenze_tief", sw::WzTool::multiband, 1}, {"mb/grenze_hoch", sw::WzTool::multiband, 2},
    {"mb/tief/schwelle", sw::WzTool::multiband, 3},  {"mb/tief/ratio", sw::WzTool::multiband, 4},  {"mb/tief/attack", sw::WzTool::multiband, 5},
    {"mb/tief/release", sw::WzTool::multiband, 6},   {"mb/tief/knie", sw::WzTool::multiband, 7},   {"mb/tief/makeup", sw::WzTool::multiband, 8},
    {"mb/tief/umgehen", sw::WzTool::multiband, 9},
    {"mb/mitte/schwelle", sw::WzTool::multiband, 10}, {"mb/mitte/ratio", sw::WzTool::multiband, 11}, {"mb/mitte/attack", sw::WzTool::multiband, 12},
    {"mb/mitte/release", sw::WzTool::multiband, 13},  {"mb/mitte/knie", sw::WzTool::multiband, 14},  {"mb/mitte/makeup", sw::WzTool::multiband, 15},
    {"mb/mitte/umgehen", sw::WzTool::multiband, 16},
    {"mb/hoch/schwelle", sw::WzTool::multiband, 17},  {"mb/hoch/ratio", sw::WzTool::multiband, 18},  {"mb/hoch/attack", sw::WzTool::multiband, 19},
    {"mb/hoch/release", sw::WzTool::multiband, 20},   {"mb/hoch/knie", sw::WzTool::multiband, 21},   {"mb/hoch/makeup", sw::WzTool::multiband, 22},
    {"mb/hoch/umgehen", sw::WzTool::multiband, 23},
    {"lim/an", sw::WzTool::limiter, 0},        {"lim/decke", sw::WzTool::limiter, 1},       {"lim/abklingen", sw::WzTool::limiter, 2},
    {"spektrum/kanal", sw::WzTool::spektrum, 0},
};
const E* finde(const char* suffix) {
  for (const E& e : ERWARTET)
    if (!std::strcmp(e.suffix, suffix)) return &e;
  return nullptr;
}
}  // namespace

int main() {
  const sw::ReglerTabelle tab;
  auto m = std::make_unique<cdj::Mixer>(tab);
  int neu = 0, spaeter = 0, falsch = 0;
  for (int r = 0; r < tab.anzahl(); ++r) {
    const sw::ReglerDef& d = tab.def(r);
    const cdj::MixZuweisung& z = m->zuweisung(r);
    const bool werkzeug = d.rolle == sw::Rolle::werkzeug || d.rolle == sw::Rolle::spektrum_kanal;
    if (!werkzeug) continue;
    ++neu;
    if (z.rolle == cdj::MixRolle::spaeter) ++spaeter;
    const char* rest = d.pfad;
    int kanal = -1;
    if (d.kanal >= 0) {
      const char* kn = tab.kanal_name(d.kanal);
      rest = d.pfad + std::strlen(kn) + 1;
      kanal = cdj::Mixer::kanal_index(kn);
    }
    const E* e = finde(rest);
    if (!e || z.rolle != cdj::MixRolle::werkzeug || z.werkzeug != e->tool || z.feld != e->feld || z.kanal != kanal) {
      ++falsch;
      std::fprintf(stderr, "%s: rolle %d tool %d feld %d kanal %d, erwartet tool %d feld %d kanal %d\n", d.pfad, static_cast<int>(z.rolle),
                   static_cast<int>(z.werkzeug), z.feld, z.kanal, e ? static_cast<int>(e->tool) : -1, e ? e->feld : -1, kanal);
    }
    PRUEF(d.kanal < 0 ? kanal == -1 : kanal >= 0);   // every channel name of the table is a mixer channel
  }
  PRUEF(neu == 345);
  PRUEF(spaeter == 0);   // (f1)
  PRUEF(falsch == 0);    // (f2)

  // (f4) the defaults arrive in the slots
  int vorgabe_falsch = 0;
  for (int r = 0; r < tab.anzahl(); ++r) {
    const sw::ReglerDef& d = tab.def(r);
    if (d.rolle != sw::Rolle::werkzeug && d.rolle != sw::Rolle::spektrum_kanal) continue;
    if (m->wert(r) != d.vorgabe) ++vorgabe_falsch;
  }
  PRUEF(vorgabe_falsch == 0);

  // (f3) a unique value per row reads back from that row only (two rows sharing a slot would overwrite each other)
  for (int r = 0; r < tab.anzahl(); ++r) {
    const sw::ReglerDef& d = tab.def(r);
    if (d.rolle == sw::Rolle::werkzeug || d.rolle == sw::Rolle::spektrum_kanal) m->setze_sofort(r, 1000.0f + static_cast<float>(r));
  }
  int alias = 0;
  for (int r = 0; r < tab.anzahl(); ++r) {
    const sw::ReglerDef& d = tab.def(r);
    if (d.rolle == sw::Rolle::werkzeug || d.rolle == sw::Rolle::spektrum_kanal)
      if (m->wert(r) != 1000.0f + static_cast<float>(r)) ++alias;
  }
  PRUEF(alias == 0);

  // negative control: old rows keep their roles
  PRUEF(m->zuweisung(tab.suche("deck/1/fader")).rolle == cdj::MixRolle::kanalzug);
  PRUEF(m->zuweisung(tab.suche("deck/1/komp/an")).rolle == cdj::MixRolle::komp);
  PRUEF(m->zuweisung(tab.suche("deck/1/ziel")).rolle == cdj::MixRolle::ziel);
  PRUEF(m->zuweisung(tab.suche("deck/1/stem/drums")).rolle == cdj::MixRolle::spaeter);   // the stems are still for a later slice
  PRUEF(finde("gate/nope") == nullptr);                                                    // harmless input: not in the table
  PRUEF_ENDE();
}
