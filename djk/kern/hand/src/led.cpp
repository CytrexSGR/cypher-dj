// Hand-Weg: LED-Nachrichten für hand_led (§7.1, §7.4); die Namensprüfung steht in namen.cpp.
#include <cstring>

#include "hand/led.h"

namespace hand {

int led_nachricht(const Mapping& m, const char* name, int zustand, uint8_t aus[3]) {
  if (zustand < 0 || zustand > 3) return 0;
  for (int i = 0; i < m.n_leds; i++) {
    const Led& l = m.led[i];
    if (std::strcmp(l.name, name) != 0) continue;
    const uint8_t status = l.nachricht.typ == NachrichtTyp::note ? 0x90 : 0xB0;
    aus[0] = static_cast<uint8_t>(status | (l.nachricht.kanal - 1));
    aus[1] = l.nachricht.nr;
    aus[2] = zustand == 0 ? l.aus : zustand == 1 ? l.an : l.blinkt;
    return 3;
  }
  return 0;
}

}  // namespace hand
