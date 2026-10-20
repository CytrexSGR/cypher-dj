// D1 K2b: ein Zyklus eines Wirt-Slot-Ausgangs (midi_ausgabe.h), wie process() ihn für arr_midi_<s> schreibt (die
// Schleife der Studio-Ströme midi_aus_<p> bleibt wörtlich, Spec 6.28). 1 Ereignisse nach Versatz, stabil (Off vor On am
// selben Sample bleibt), Versatz ≥ n fällt weg. 2 Ein
// fälliger All-Off-Plan schreibt seine 32 Ereignisse bei Versatz 0 vor allen anderen; ein nicht fälliger nichts.
// 3 Puffer voll: der Plan meldet PUFFER_VOLL und setzt im nächsten Zyklus fort. Mutation MIDI_UNSORTIERT: Fall 1 rot.
#include <vector>

#include "cypherdj/midi_ausgabe.h"
#include "pruef.h"

namespace {
struct Ev {
  uint32_t t;
  uint8_t b[3];
};
}  // namespace

int main() {
  uint8_t tab[cdj::ALLE_AUS_N][3];
  PRUEF(cdj::alle_aus_ereignisse(tab, cdj::ALLE_AUS_N) == cdj::ALLE_AUS_N);
  {  // 1
    cdj::MidiAus m;
    m.schreibe(100, 0x90, 60, 90);
    m.schreibe(20, 0x80, 59, 0);
    m.schreibe(100, 0x80, 62, 0);   // gleicher Versatz wie das On davor: Reihenfolge bleibt
    m.schreibe(300, 0x90, 64, 90);  // hinter dem Zyklus (n = 256)
    m.schreibe(0, 0xB0, 123, 0);
    cdj::AllAusPlan plan;
    std::vector<Ev> aus;
    cdj::midi_zyklus(plan, 1000, tab, m, 256u, [&](uint32_t t, const uint8_t* b) {
      aus.push_back({t, {b[0], b[1], b[2]}});
      return true;
    });
    PRUEF(aus.size() == 4);
    if (aus.size() == 4) {
      PRUEF(aus[0].t == 0 && aus[0].b[1] == 123);
      PRUEF(aus[1].t == 20 && aus[1].b[1] == 59);
      PRUEF(aus[2].t == 100 && aus[2].b[0] == 0x90 && aus[2].b[1] == 60);
      PRUEF(aus[3].t == 100 && aus[3].b[0] == 0x80 && aus[3].b[1] == 62);
    }
  }
  {  // 2
    cdj::MidiAus m;
    m.schreibe(0, 0x90, 60, 90);
    cdj::AllAusPlan plan;
    plan.setze(0);   // fällig ab 150 ms
    std::vector<Ev> aus;
    auto w = [&](uint32_t t, const uint8_t* b) {
      aus.push_back({t, {b[0], b[1], b[2]}});
      return true;
    };
    PRUEF(cdj::midi_zyklus(plan, 100'000'000, tab, m, 256u, w) == cdj::AllAusPlan::NICHTS && aus.size() == 1);
    aus.clear();
    PRUEF(cdj::midi_zyklus(plan, 160'000'000, tab, m, 256u, w) == cdj::AllAusPlan::GESENDET);
    PRUEF(aus.size() == 33 && aus[0].b[0] == 0xB0 && aus[31].t == 0 && aus[32].b[0] == 0x90);
  }
  {  // 3
    cdj::MidiAus m;
    cdj::AllAusPlan plan;
    plan.setze(0);
    int platz = 10;
    auto w = [&](uint32_t, const uint8_t*) { return platz-- > 0; };
    PRUEF(cdj::midi_zyklus(plan, 160'000'000, tab, m, 256u, w) == cdj::AllAusPlan::PUFFER_VOLL);
    platz = 100;
    PRUEF(cdj::midi_zyklus(plan, 161'000'000, tab, m, 256u, w) == cdj::AllAusPlan::GESENDET);
  }
  PRUEF_ENDE();
}
