// Scheibe 19: LED-Nachrichtenbau für hand_led (§7.1, §7.4), Zustände wie /k/led (§4.7).
#include <cstdint>
#include <cstdio>
#include <memory>

#include "hand/led.h"
#include "hand/mapping.h"
#include "pruef.h"

using namespace hand;

FALL(nachricht_je_zustand) {
  const char* text = R"({"version":1,"geraet":"t","quelle_port":"q","ziel_port":"z","eintraege":[],
 "leds":[{"name":"vorschlag","nachricht":{"typ":"note","kanal":16,"nr":10},"werte":{"aus":0,"an":127,"blinkt":64}},
         {"name":"deck2_loop","nachricht":{"typ":"cc","kanal":2,"nr":99},"werte":{"aus":1,"an":2,"blinkt":3}}]})";
  auto m = std::make_unique<Mapping>();
  Fehler f;
  PRUEFE(lade(text, stellwerk::ReglerTabelle(), m.get(), &f));
  uint8_t b[3] = {0, 0, 0};
  const struct { int z; uint8_t w; } T[] = {{0, 0}, {1, 127}, {2, 64}, {3, 64}};
  for (const auto& t : T) {
    PRUEFE_GLEICH(led_nachricht(*m, "vorschlag", t.z, b), 3);
    PRUEFE_GLEICH(b[0], 0x9F);
    PRUEFE_GLEICH(b[1], 10);
    PRUEFE_GLEICH(b[2], t.w);
  }
  PRUEFE_GLEICH(led_nachricht(*m, "deck2_loop", 1, b), 3);
  PRUEFE_GLEICH(b[0], 0xB1);
  PRUEFE_GLEICH(b[1], 99);
  PRUEFE_GLEICH(b[2], 2);
}

FALL(negativ_kontrolle_unbekannt_oder_ungueltig_sendet_nichts) {
  auto m = std::make_unique<Mapping>();
  Fehler f;
  PRUEFE(lade(R"({"version":1,"geraet":"t","quelle_port":"q","eintraege":[]})", stellwerk::ReglerTabelle(), m.get(), &f));
  uint8_t b[3] = {7, 7, 7};
  PRUEFE_GLEICH(led_nachricht(*m, "vorschlag", 1, b), 0);   // Gerät ohne diese LED
  PRUEFE_GLEICH(b[0], 7);
  PRUEFE_GLEICH(led_nachricht(*m, "vorschlag", 4, b), 0);   // Zustand gibt es nicht
}

PRUEF_MAIN
