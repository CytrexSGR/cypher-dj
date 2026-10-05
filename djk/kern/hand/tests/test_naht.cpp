// Scheibe 19: Naht zum Stellwerk (Scheibe 11). MIDI-Bytes -> Übersetzer -> zu_griff -> Stellwerk::hand wie im Kern
// (Scheibe 35); /test/hand (§19.0) hat dieselbe Semantik wie ein MIDI-Ereignis; Encoder beider Kodierungen bewegen den
// Regler in die richtige Richtung; eine Taste schaltet einen Schalter um; die Hand bricht einen Plan am Versatz-Sample.
#include <cmath>
#include <cstdint>
#include <memory>
#include <vector>

#include "hand/mapping.h"
#include "hand/naht_stellwerk.h"
#include "hand/uebersetzer.h"
#include "pruef.h"
#include "sim_uhr.h"
#include "cypherdj/stellwerk/stellwerk.h"

using namespace hand;
using stellwerk::Griff;
using stellwerk::GriffArt;

namespace {

const char* const MAPPING = R"({"version":1,"geraet":"test","quelle_port":"q",
 "eintraege":[
  {"nachricht":{"typ":"cc","kanal":2,"nr":7},"ziel":"deck/2/fader","art":"absolut"},
  {"nachricht":{"typ":"cc","kanal":1,"nr":20},"ziel":"deck/1/eq/tief","art":"relativ","kodierung":"zweierkomplement",
   "kurve":{"typ":"linear","min":-26.0,"max":6.0},"kill_unter_min":true},
  {"nachricht":{"typ":"cc","kanal":2,"nr":20},"ziel":"deck/2/eq/tief","art":"relativ","kodierung":"versatz64",
   "kurve":{"typ":"linear","min":-26.0,"max":6.0},"kill_unter_min":true},
  {"nachricht":{"typ":"note","kanal":1,"nr":36},"ziel":"deck/1/kill/tief","art":"taste"},
  {"nachricht":{"typ":"note","kanal":2,"nr":37},"ziel":"deck/2/fader","art":"beruehrung"},
  {"nachricht":{"typ":"note","kanal":1,"nr":44},"ziel":"deck/1/play","art":"taste"}]})";

// Ein Stellwerk an einer simulierten Uhr (128 BPM), Zyklen zu 256 Samples; MIDI geht wie im Kern hinein
struct Kern {
  stellwerk::SimUhr uhr{128.0};
  std::unique_ptr<stellwerk::Stellwerk> sw = std::make_unique<stellwerk::Stellwerk>(uhr);
  std::unique_ptr<Mapping> m = std::make_unique<Mapping>();
  std::unique_ptr<Uebersetzer> u;
  std::vector<stellwerk::Ereignis> ereignisse;
  Kern() {
    Fehler f;
    if (!lade(MAPPING, sw->tabelle(), m.get(), &f)) {
      std::printf("  Mapping: %s\n", f.text);
      pruef::fehler()++;
    }
    u = std::make_unique<Uebersetzer>(m.get());
  }
  int r(const char* p) const { return sw->tabelle().suche(p); }
  // MIDI im Zyklus, der `sample` enthält, am Versatz sample - s0
  void midi(int64_t sample, uint8_t s, uint8_t a, uint8_t b) {
    bis(sample - sample % 256);
    const uint8_t d[3] = {s, a, b};
    Ausgabe aus{};
    if (u->ereignis(d, 3, sw->jetzt(), static_cast<uint32_t>(sample - sw->jetzt()), 256, &aus) != 1) return;
    const int reg = m->eintrag[aus.eintrag].regler;   // -1 bei Deck, Tempo, Taste
    Griff g{};
    if (zu_griff(aus, *m, reg >= 0 ? sw->wert(reg) : 0.0f, &g)) sw->hand(g);
  }
  void bis(int64_t s) {
    while (sw->jetzt() < s) {
      sw->prozess(sw->jetzt(), 256);
      const stellwerk::Ereignis* e;
      const int n = sw->ereignisse(&e);
      ereignisse.insert(ereignisse.end(), e, e + n);
      sw->ereignisse_leeren();
    }
  }
  int64_t quittung(int64_t id, stellwerk::Status st) const {
    for (const auto& e : ereignisse)
      if (e.art == stellwerk::EreignisArt::quittung && e.id == id && e.status == st) return e.sample;
    return -1;
  }
};

}  // namespace

FALL(test_hand_und_midi_liefern_denselben_griff) {
  Kern k;
  for (uint8_t v : {0, 1, 64, 100, 127}) {
    const uint8_t d[3] = {0xB1, 7, v};
    Ausgabe a{};
    PRUEFE_GLEICH(k.u->ereignis(d, 3, 1000, 17, 256, &a), 1);
    Griff aus_midi{}, aus_test{};
    PRUEFE(zu_griff(a, *k.m, 0.0f, &aus_midi));
    PRUEFE(test_hand_griff(k.sw->tabelle(), "deck/2/fader", v / 127.0f, 1017, &aus_test));
    PRUEFE_GLEICH(aus_midi.sample, aus_test.sample);
    PRUEFE_GLEICH(aus_midi.regler, aus_test.regler);
    PRUEFE(aus_midi.art == aus_test.art && aus_midi.kurve == aus_test.kurve);
    PRUEFE_NAH(aus_midi.x, aus_test.x, 0);
  }
  Griff g{};
  PRUEFE(!test_hand_griff(k.sw->tabelle(), "deck/2/transport", 0.5f, 0, &g));
  PRUEFE(!test_hand_griff(k.sw->tabelle(), "deck/2/fadr", 0.5f, 0, &g));
}

FALL(test_hand_und_midi_gleich_am_stellwerk_erster_wert_nur_stellung) {
  // zwei Stellwerke, dieselbe Folge: einmal über MIDI, einmal über /test/hand; Werte sampleweise gleich
  Kern a, b;
  a.sw->setze_direkt(a.r("deck/2/fader"), -10.0f);
  b.sw->setze_direkt(b.r("deck/2/fader"), -10.0f);
  const struct { int64_t s; uint8_t v; } F[] = {{10000, 64}, {20000, 80}, {30000, 90}, {40000, 20}};
  for (const auto& f : F) {
    a.midi(f.s, 0xB1, 7, f.v);
    b.bis(f.s - f.s % 256);
    Griff g{};
    PRUEFE(test_hand_griff(b.sw->tabelle(), "deck/2/fader", f.v / 127.0f, f.s, &g));
    b.sw->hand(g);
  }
  a.bis(50000);
  b.bis(50000);
  PRUEFE_NAH(a.sw->wert(a.r("deck/2/fader")), b.sw->wert(b.r("deck/2/fader")), 0);
  // der erste Wert (64 bei 10000) hat nur die Stellung gesetzt: ohne die weiteren Griffe bliebe es bei -10 dB
  Kern c;
  c.sw->setze_direkt(c.r("deck/2/fader"), -10.0f);
  c.midi(10000, 0xB1, 7, 64);
  c.bis(20000);
  PRUEFE_NAH(c.sw->wert(c.r("deck/2/fader")), -10.0, 0);
}

FALL(encoder_beider_kodierungen_richtig_herum_am_regler) {
  // von 0 dB drei Rasten rauf und drei runter; x = zu_x(0) +- 3/127 = 0,8125 +- 0,023622 -> -26 + 32 x
  const double rauf = -26.0 + 32.0 * (26.0 / 32.0 + 3.0 / 127.0);
  const double runter = -26.0 + 32.0 * (26.0 / 32.0 - 3.0 / 127.0);
  {
    Kern k;   // zweierkomplement: +1 = 1, -1 = 127
    for (int i = 0; i < 3; i++) k.midi(1000 + i * 1000, 0xB0, 20, 1);
    k.bis(5000);
    PRUEFE_NAH(k.sw->wert(k.r("deck/1/eq/tief")), rauf, 1e-3);
    for (int i = 0; i < 6; i++) k.midi(6000 + i * 1000, 0xB0, 20, 127);
    k.bis(13000);
    PRUEFE_NAH(k.sw->wert(k.r("deck/1/eq/tief")), runter, 1e-3);
  }
  {
    Kern k;   // versatz64: +1 = 65, -1 = 63
    for (int i = 0; i < 3; i++) k.midi(1000 + i * 1000, 0xB1, 20, 65);
    k.bis(5000);
    PRUEFE_NAH(k.sw->wert(k.r("deck/2/eq/tief")), rauf, 1e-3);
    for (int i = 0; i < 6; i++) k.midi(6000 + i * 1000, 0xB1, 20, 63);
    k.bis(13000);
    PRUEFE_NAH(k.sw->wert(k.r("deck/2/eq/tief")), runter, 1e-3);
  }
}

FALL(encoder_aus_kill_ganz_unten) {
  Kern k;
  k.sw->setze_direkt(k.r("deck/1/eq/tief"), -200.0f);
  k.midi(1000, 0xB0, 20, 1);
  k.bis(2000);
  PRUEFE_NAH(k.sw->wert(k.r("deck/1/eq/tief")), -25.748, 1e-3);
  k.midi(3000, 0xB0, 20, 127);
  k.bis(4000);
  PRUEFE_NAH(k.sw->wert(k.r("deck/1/eq/tief")), -200.0, 0);
}

FALL(taste_schaltet_kill_um) {
  Kern k;
  const int r = k.r("deck/1/kill/tief");
  k.midi(1000, 0x90, 36, 127);
  k.midi(1100, 0x80, 36, 0);
  k.bis(2000);
  PRUEFE_NAH(k.sw->wert(r), 1.0, 0);
  k.midi(3000, 0x90, 36, 127);
  k.midi(3100, 0x80, 36, 0);
  k.bis(4000);
  PRUEFE_NAH(k.sw->wert(r), 0.0, 0);
}

FALL(hand_bricht_plan_am_versatz_sample) {
  // teil_rampe (§19.3): deck/2/fader -15 -> 0 dB ab Beat 64 über 32 Beats; Berührung bei Sample 1 620 000, das
  // mitten im Block ab 1 619 968 liegt (Versatz 32): Abbruch genau dort
  Kern k;
  k.sw->setze_direkt(k.r("deck/2/fader"), -15.0f);
  k.sw->teil(stellwerk::TeilBefehl{7, stellwerk::Quelle::cypher, "p", 0, "deck/2/fader", 64.0, 32.0, 0.0f, 0, 0, "", ""});
  k.midi(1620000, 0x91, 37, 127);
  k.bis(1700000);
  PRUEFE_GLEICH(k.quittung(7, stellwerk::Status::abgebrochen), 1620000);
  PRUEFE(k.sw->halter(k.r("deck/2/fader")).art == stellwerk::HalterArt::mensch);
}

FALL(negativ_kontrolle_deck_taste_ist_kein_griff_und_ohne_hand_laeuft_der_plan) {
  Kern k;
  const uint8_t d[3] = {0x90, 44, 127};
  Ausgabe a{};
  PRUEFE_GLEICH(k.u->ereignis(d, 3, 0, 0, 256, &a), 1);
  Griff g{};
  PRUEFE(!zu_griff(a, *k.m, 0.0f, &g));
  k.sw->setze_direkt(k.r("deck/2/fader"), -15.0f);
  k.sw->teil(stellwerk::TeilBefehl{8, stellwerk::Quelle::cypher, "p", 0, "deck/2/fader", 64.0, 32.0, 0.0f, 0, 0, "", ""});
  k.bis(2200000);
  PRUEFE_GLEICH(k.quittung(8, stellwerk::Status::fertig), 2160000);
  PRUEFE_GLEICH(k.quittung(8, stellwerk::Status::abgebrochen), -1);
}

PRUEF_MAIN
