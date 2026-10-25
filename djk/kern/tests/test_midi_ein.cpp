// I08 Task 2: MidiEin. Jedes Ereignis mit Kern-Sample = Zyklusanfang + JACK-Versatz; Überlauf wird gezählt, nie still verworfen.
#include "cypherdj/midi_ein.h"
#include "pruef.h"

int main() {
  const uint8_t on[3] = {0x90, 60, 100};
  {
    cdj::MidiEin m;
    PRUEF(m.letztes_sample() == -1 && m.gesehen() == 0);
    m.schiebe(1000, 7, on, 3);
    cdj::MidiEinEreignis e{};
    PRUEF(m.hole(e));
    PRUEF(e.sample == 1007 && e.n == 3 && e.b[0] == 0x90 && e.b[1] == 60 && e.b[2] == 100);
    PRUEF(!m.hole(e));  // leer
    PRUEF(m.letztes_sample() == 1007 && m.gesehen() == 1);
    const uint8_t takt = 0xF8;  // Einbyte-Nachricht (Clock)
    m.schiebe(2000, 0, &takt, 1);
    PRUEF(m.hole(e) && e.n == 1 && e.b[0] == 0xF8 && e.sample == 2000);
    const uint8_t syx[5] = {0xF0, 1, 2, 3, 0xF7};  // SysEx: zu lang, gezählt, nicht im Ring
    m.schiebe(3000, 0, syx, 5);
    PRUEF(m.zu_lang() == 1 && !m.hole(e));
    m.schiebe(3000, 0, on, 0);  // leer: nichts
    PRUEF(!m.hole(e));
  }
  {  // Überlauf: KAP Ereignisse ohne Leser passen, das nächste geht verloren und wird gezählt
    cdj::MidiEin v;
    for (size_t i = 0; i < cdj::MidiEin::KAP; ++i) v.schiebe(static_cast<int64_t>(i), 0, on, 3);
    PRUEF(v.verloren() == 0);
    v.schiebe(99999, 0, on, 3);
    PRUEF(v.verloren() == 1);
    cdj::MidiEinEreignis e{};
    PRUEF(v.hole(e) && e.sample == 0);  // das älteste steht noch da, nichts überschrieben
  }
  PRUEF_ENDE();
}
